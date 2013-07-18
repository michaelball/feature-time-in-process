Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    items: [
        {
            xtype: 'container',
            itemId: 'chart1',
            columnWidth: 1
        }
    ],

    launch: function() {
        //get reference to lumenize
        this._lumenize = window.parent.Rally.data.lookback.Lumenize;

        //Time range is epoch to current month
        this._startOn = '2011-12';
        this._endBefore = new this._lumenize.Time(new Date()).inGranularity(this._lumenize.Time.MONTH).toString();

        this._parseHangmanVariablesFromQueryString();
        this._getWorkspaceConfig();
    },

    _getFiscalQuarter: function(validToTimeString) {
        var Time = this._lumenize.Time;
        var timezome = this._workspaceConfig.TimeZone;

        //Assumes fiscal quarters are offset 1 month (in the future) from calendar quarters
        //The algorithm goes like this:
        // 1) Find the calendar quarter of the validToTimeString
        // 2) Find the start month of the calendar quarter
        // 3) Add 1 month to the start month of the calendar quarter to find
        //    the start month of the fiscal quarter.
        // 4) If the validTo time (in month granularity) is less than the start
        //    of the fiscal quarter, go back to the previous calendar quarter,
        //    otherwise use the calendar quarter we found in step 1.
        // 5) Format the calendar quarter as a fiscal quarter.
        var calendarQuarter = new Time(validToTimeString, Time.QUARTER, timezome).inGranularity(Time.QUARTER);
        var calendarQuarterStart = calendarQuarter.inGranularity(Time.MONTH);
        var fiscalQuarterStart = calendarQuarterStart.add(1);
        var validTo = new Time(validToTimeString, Time.MONTH, timezome).inGranularity(Time.MONTH);

        var quarter;
        if (validTo.lessThan(fiscalQuarterStart)) {
            quarter = calendarQuarter.add(-1);
        } else {
            quarter = calendarQuarter;
        }

        var year = (quarter.year + 1).toString();
        return 'FY' + year.substring(2) + 'Q' + quarter.quarter;
    },

    _parseHangmanVariablesFromQueryString: function() {
        //For testing outside of rally
        var queryObject = Ext.Object.fromQueryString(location.search);
        Ext.Object.each(queryObject, function(key, value) {
            //If it matches the hangman variable format, and is not already set globally... set it
            //Note that actual hangman variables are not set in the global scope, they are
            //string replaced into the document itself.
            if (/^__[_A-Z]+__$/.test(key) && window[key] == null) {
                window[key] = value;
            }
        });
    },

    _getProjectScopedQuery: function(query) {
        //TODO - support scope up/down and all that cool stuff
        return Ext.merge({
            '_ProjectHierarchy': Number(__PROJECT_OID__)
        }, query);
    },

    _getWorkspaceConfig: function() {
        Ext.create('Rally.data.WsapiDataStore', {
            autoLoad: true,
            model: 'Workspace Configuration',
            fetch: true,
            listeners: {
                load: this._onWorkspaceConfigLoaded,
                scope : this
            }
        });
    },

    _onWorkspaceConfigLoaded: function(store) {
        var isCurrentWorkspace = new RegExp('^/workspace/' + __WORKSPACE_OID__ + '$');
        var i = store.findBy(function(record) {
            return isCurrentWorkspace.test(record.data.Workspace._ref);
        });
        this._workspaceConfig = store.getAt(i).data;
        this._getTISCResults();
    },
    
    _getTISCResults: function() {
        Ext.create('Rally.data.lookback.SnapshotStore', {
            autoLoad : true,
            listeners: {
                load: this._onTISCSnapShotData,
                scope : this
            },
            fetch: ['ObjectID', '_ProjectHierarchy', '_ValidTo', '_ValidFrom'],
            find: this._getProjectScopedQuery({
                '_ValidFrom': {
                    '$gte': this._startOn,
                    '$lt': this._endBefore
                },
                '_TypeHierarchy': 'PortfolioItem/Feature',
                // In development and < 100 % done
                'State': 'In Dev',
                'PercentDoneByStoryCount': {
                    '$lt': 1,
                    '$gt': 0
                }
            })
        });
    },

    _onTISCSnapShotData : function(store, models) {
        //Extract the raw snapshot data...
        var snapshots = Ext.Array.map(models, function(model){
            return model.data;
        });

        var config = {
            granularity: 'hour',
            tz: this._workspaceConfig.TimeZone,
            workDays: this._workspaceConfig.WorkDays.split(','),
            endBefore: this._endBefore,

            // assume 9-5
            workDayStartOn: {hour: 9, minute: 0},
            workDayEndBefore: {hour: 17, minute: 0},

            // TODO - knock out holidays...

            // holidays: Rally.redpill.util.Holidays.federal(),

            trackLastValueForTheseFields: ["_ValidTo", "_ProjectHierarchy"]
        };

        // store number of hours in a work day
        var startOnInMinutes = config.workDayStartOn.hour * 60 + config.workDayStartOn.minute;
        var endBeforeInMinutes = config.workDayEndBefore.hour * 60 + config.workDayEndBefore.minute;
        if (startOnInMinutes < endBeforeInMinutes) {
            workMinutes = endBeforeInMinutes - startOnInMinutes;
        } else{
          workMinutes = 24 * 60 - startOnInMinutes;
          workMinutes += endBeforeInMinutes;
        }
        this._workDayHours = workMinutes / 60;

        var tisc = new this._lumenize.TimeInStateCalculator(config);
        tisc.addSnapshots(snapshots, this._startOn, this._endBefore);

        this._tiscResults = tisc.getResults();

        this._getCompletedOids();
    },

    _getCompletedOids: function(type, afterCompletedOIDs){
        Ext.create('Rally.data.lookback.SnapshotStore', {
            autoLoad : true,
            listeners: {
                load: this._onCompletedOids,
                scope : this
            },
            fetch: ['ObjectID', '_ProjectHierarchy', '_ValidTo', '_ValidFrom'],
            find: this._getProjectScopedQuery({
                '__At': this._endBefore,
                '_TypeHierarchy':  'PortfolioItem/Feature',
                // Not in development anymore or >= 100% done
                '$or': [
                    { 'State': { '$gt': 'In Dev' } },
                    { 'PercentDoneByStoryCount': { '$gte': 1 } }
                ]
            })
        });
    },

    _onCompletedOids: function(store, models) {
        //Build map of completed oids
        var completedOids = {};
        Ext.each(models, function(model) {
            completedOids[model.data.ObjectID] = true;
        });

        var p80 = this._lumenize.functions.percentileCreator(80);

        var convertTicksToHours = Ext.bind(function(row) {
            return row.ticks / this._workDayHours;
        }, this);

        var fiscalQuarter = Ext.bind(function(row) {
            return this._getFiscalQuarter(row._ValidTo_lastValue);
        }, this);

        var cube = new this._lumenize.OLAPCube({
            deriveFieldsOnInput: [
                { field: "hours", f: convertTicksToHours },
                { field: "quarter", f: fiscalQuarter }
            ],
            metrics: [
                { field: "hours", f: "values" }
            ],
            deriveFieldsOnOutput: [
                { field: "timeInProcess", f: function(row) { return p80(row.hours_values); } }
            ],
            dimensions: [
                { field: "quarter" }
            ]
        });

        var tiscResultsFilteredByCompletion = Ext.Array.filter(this._tiscResults, function(result) {
            return !!completedOids[result.ObjectID];
        });

        cube.addFacts(tiscResultsFilteredByCompletion);

        this._showChart(cube.cells);
    },

    _showChart : function(cells) {

        //Sort ascending by quarter
        cells.sort(function(a, b) {
            if (a.quarter < b.quarter) {
                return -1;
            } else if (a.quarter > b.quarter) {
                return 1;
            } else {
                return 0;
            }
        });

        var quarters = Ext.Array.map(cells, function(cell) {
            return cell.quarter;
        });

        var timeInProcess = Ext.Array.map(cells, function(cell) {
            return cell.timeInProcess;
        });

        var chart = this.down("#chart1");
        chart.removeAll();
        
        var extChart = Ext.create('Rally.ui.chart.Chart', {
            width: 800,
            height: 500,
            chartData: {
                categories : quarters,
                series : [
                    {
                        data: timeInProcess,
                        name: 'Time in Process'
                    }
                ]
            },
            chartConfig : {
                chart: {
                    type: 'column'
                },
                title: {
                    text: 'Feature Time in Process',
                    x: -20 //center
                },                        
                xAxis: {
                    tickInterval : 1,
                    title: {
                        text: 'Fiscal Quarters'
                    }
                },
                yAxis: [{
                    title: {
                        text: 'p80 Time in Process (days)'
                    },
                    plotLines: [{
                        value: 0,
                        width: 1,
                        color: '#808080'
                    }]
                }],
                tooltip: {
                    valueSuffix: ''
                },
                legend: {
                    align: 'center',
                    verticalAlign: 'bottom'
                },
                plotOptions : {
                    column: {
                       stacking: 'normal',
                       tooltip : {
                           valueSuffix : ' days'
                       }
                    }
                }
            }
        });
        chart.add(extChart);

        var p = Ext.get(chart.id);
        var elems = p.query("div.x-mask");
        Ext.each(elems, function(e) { e.remove(); });
        elems = p.query("div.x-mask-msg");
        Ext.each(elems, function(e) { e.remove(); });
    }            
});
