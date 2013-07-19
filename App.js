//Get reference to Lumenize
var Lumenize = window.parent.Rally.data.lookback.Lumenize,
    OLAPCube = Lumenize.OLAPCube,
    Time = Lumenize.Time,
    TimeInStateCalculator = Lumenize.TimeInStateCalculator;

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
        //Time range is epoch to current month
        this._startOn = '2011-12';
        this._endBefore = new Time(new Date()).inGranularity(Time.MONTH).toString();

        this._parseHangmanVariablesFromQueryString();
        this._showChart();
        this._getWorkspaceConfig();
    },

    _getFiscalQuarter: function(row) {
        var validToTimeString = row._ValidTo_lastValue;
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

    _getMonth: function(row) {
        var timezome = this._workspaceConfig.TimeZone;
        return new Time(row._ValidTo_lastValue, Time.MONTH, timezome).inGranularity(Time.MONTH).toString();
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

            holidays: this._federalHolidays(),

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

        var tisc = new TimeInStateCalculator(config);
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

        var p80 = Lumenize.functions.percentileCreator(80);

        var convertTicksToHours = Ext.bind(function(row) {
            return row.ticks / this._workDayHours;
        }, this);

        var cube = new OLAPCube({
            deriveFieldsOnInput: [
                { field: "hours", f: convertTicksToHours },
                { field: "month", f: Ext.bind(this._getMonth, this) }
            ],
            metrics: [
                { field: "hours", f: "values" }
            ],
            deriveFieldsOnOutput: [
                { field: "timeInProcess", f: function(row) { return p80(row.hours_values); } }
            ],
            dimensions: [
                { field: "month" }
            ]
        });

        var tiscResultsFilteredByCompletion = Ext.Array.filter(this._tiscResults, function(result) {
            return !!completedOids[result.ObjectID];
        });

        cube.addFacts(tiscResultsFilteredByCompletion);

        this._showChartData(cube.cells);
    },

    _showChart : function() {
        var chart = this.down("#chart1");
        chart.removeAll();
        
        this._extChart = Ext.create('Rally.ui.chart.Chart', {
            width: 800,
            height: 500,
            chartData: {
                categories: [],
                series : []
            },
            chartConfig : {
                chart: {
                    type: 'column'
                },
                title: {
                    text: 'Feature Time in Process'
                },                        
                xAxis: {
                    tickInterval : 1,
                    title: {
                        text: 'Months'
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
        chart.add(this._extChart);
    },

    _showChartData: function(cells) {
        //Sort ascending by month
        cells.sort(function(a, b) {
            if (a.month < b.month) {
                return -1;
            } else if (a.month > b.month) {
                return 1;
            } else {
                return 0;
            }
        });

        var months = Ext.Array.map(cells, function(cell) {
            return cell.month;
        });

        var timeInProcess = Ext.Array.map(cells, function(cell) {
            return cell.timeInProcess;
        });

        //Call _unmask() because setLoading(false) doesn't work
        this._extChart._unmask();

        //Grab the chart's chart's chart
        var chart = this._extChart.down('highchart').chart;

        //Now we have the nice highcharts interface we all know and love
        chart.xAxis[0].setCategories(months, true);
        chart.addSeries({
            name: 'Time in Process',
            data: timeInProcess,
            color: this._extChart.chartColors[0]
        });
    },

    _federalHolidays: function() {
        //Source: http://www.opm.gov/operating_status_schedules/fedhol/2013.asp

        return [
            //2011
            '2010-12-31',
            '2011-01-17',
            '2011-02-21',
            '2011-05-30',
            '2011-07-04',
            '2011-09-05',
            '2011-10-10',
            '2011-11-11',
            '2011-11-24',
            '2011-12-26',

            //2012
            '2012-01-02',
            '2012-01-16',
            '2012-02-20',
            '2012-05-28',
            '2012-07-04',
            '2012-09-03',
            '2012-10-08',
            '2012-11-12',
            '2012-11-22',
            '2012-12-25',

            //2013
            '2013-01-01',
            '2013-01-21',
            '2013-02-18',
            '2013-05-27',
            '2013-07-04',
            '2013-09-02',
            '2013-10-14',
            '2013-11-11',
            '2013-11-28',
            '2013-12-25',

            //2014
            '2014-01-01',
            '2014-01-20',
            '2014-02-17',
            '2014-05-26',
            '2014-07-04',
            '2014-09-01',
            '2014-10-13',
            '2014-11-11',
            '2014-11-27',
            '2014-12-25',

            //2015
            '2015-01-01',
            '2015-01-19',
            '2015-02-16',
            '2015-05-25',
            '2015-07-03',
            '2015-09-07',
            '2015-10-12',
            '2015-11-11',
            '2015-11-26',
            '2015-12-25',

            //2016
            '2016-01-01',
            '2016-01-18',
            '2016-02-15',
            '2016-05-30',
            '2016-07-04',
            '2016-09-05',
            '2016-10-10',
            '2016-11-11',
            '2016-11-24',
            '2016-12-26',

            //2017
            '2017-01-02',
            '2017-01-16',
            '2017-02-20',
            '2017-05-29',
            '2017-07-04',
            '2017-09-04',
            '2017-10-09',
            '2017-11-10',
            '2017-11-23',
            '2017-12-25',

            //2018
            '2018-01-01',
            '2018-01-15',
            '2018-02-19',
            '2018-05-28',
            '2018-07-04',
            '2018-09-03',
            '2018-10-08',
            '2018-11-12',
            '2018-11-22',
            '2018-12-25',

            //2019
            '2013-01-01',
            '2019-01-21',
            '2019-02-18',
            '2019-05-27',
            '2019-07-04',
            '2019-09-02',
            '2019-10-14',
            '2019-11-11',
            '2019-11-28',
            '2019-12-25',

            //2020
            '2020-01-01',
            '2020-01-20',
            '2020-02-17',
            '2020-05-25',
            '2020-07-03',
            '2020-09-07',
            '2020-10-12',
            '2020-11-11',
            '2020-11-26',
            '2020-12-25'
        ];
    }
});
