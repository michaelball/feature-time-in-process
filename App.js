//Get reference to Lumenize
var Lumenize = window.parent.Rally.data.lookback.Lumenize,
    OLAPCube = Lumenize.OLAPCube,
    Time = Lumenize.Time,
    TimeInStateCalculator = Lumenize.TimeInStateCalculator;

function Months(startOn, endBefore, timezone) {
    var cursor = new Time(startOn).inGranularity(Time.MONTH),
        end = new Time(endBefore).inGranularity(Time.MONTH),
        categories = [];

    while (cursor.lessThanOrEqual(end)) {
        categories.push(cursor.toString());
        cursor = cursor.add(1);
    }

    this.categories = categories;
    this.label = 'Months';
    this.field = '_ValidTo';

    this.categorize = function(value) {
        return new Time(value._ValidTo_lastValue, Time.MONTH, timezone).inGranularity(Time.MONTH).toString();
    };
}

function Quarters(startOn, endBefore, timezone) {
    var cursor = new Time(startOn).inGranularity(Time.QUARTER),
        end = new Time(endBefore).inGranularity(Time.QUARTER),
        categories = [];

    while (cursor.lessThanOrEqual(end)) {
        categories.push(cursor.toString());
        cursor = cursor.add(1);
    }

    this.categories = categories;
    this.label = 'Quarters';
    this.field = '_ValidTo';

    this.categorize = function(value) {
        return new Time(value._ValidTo_lastValue, Time.QUARTER, timezone).inGranularity(Time.QUARTER).toString();
    };
}

function FiscalQuarters(startOn, endBefore, timezone) {
    this.label = 'Fiscal Quarters';
    this.field = '_ValidTo';

    this.categorize = function(value) {
        var validToTimeString = value._ValidTo_lastValue || value;

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
        var calendarQuarter = new Time(validToTimeString, Time.QUARTER, timezone).inGranularity(Time.QUARTER);
        var calendarQuarterStart = calendarQuarter.inGranularity(Time.MONTH);
        var fiscalQuarterStart = calendarQuarterStart.add(1);
        var validTo = new Time(validToTimeString, Time.MONTH, timezone).inGranularity(Time.MONTH);

        var quarter;
        if (validTo.lessThan(fiscalQuarterStart)) {
            quarter = calendarQuarter.add(-1);
        } else {
            quarter = calendarQuarter;
        }

        var year = (quarter.year + 1).toString();
        return 'FY' + year.substring(2) + 'Q' + quarter.quarter;
    };

    var cursor = new Time(startOn).inGranularity(Time.QUARTER),
        end = new Time(endBefore).inGranularity(Time.QUARTER),
        categories = [];

    while (cursor.lessThanOrEqual(end)) {
        categories.push(this.categorize(cursor.toString()));
        cursor = cursor.add(1);
    }

    this.categories = categories;
}

function StoryPoints() {

    this.categories = ['&lt; 1', '2', '3', '5', '8', '&gt; 8'];
    this.label = 'Story Points';
    this.field = 'PlanEstimate';

    this.categorize = function(value) {
        var p = value.PlanEstimate_lastValue;
        if (p < 1) {
            return '&lt; 1';
        } else if (p <= 2) {
            return '2';
        } else if (p <= 3) {
            return '3';
        } else if (p <= 5) {
            return '5';
        } else if (p <= 8) {
            return '8';
        } else if (p > 8) {
            return '&gt; 8';
        }
    };
}

function FeatureSize() {
    this.categories = ['Extra Small', 'Small', 'Medium', 'Large', 'Extra Large', 'Unestimated'];
    this.label = 'Feature Size';
    this.field = 'PreliminaryEstimate';

    var sizes = {
        4484657773: 'Extra Small',
        4484657774: 'Small',
        4484657775: 'Medium',
        4484657776: 'Large',
        4484657777: 'Extra Large'
    };

    this.categorize = function(value) {
        return sizes[value.PreliminaryEstimate_lastValue] || 'Unestimated';
    };
}

function Feature() {
    var typeHierarchy = 'PortfolioItem/Feature';
    this.progressPredicate = function() {
        return {
            // Features in development and < 100 % done
            '_TypeHierarchy': typeHierarchy,
            'State': 'In Dev',
            'PercentDoneByStoryCount': {
                '$lt': 1,
                '$gt': 0
            }
        };
    };
    this.completePredicate = function() {
        return {
            // Features not in development anymore or >= 100% done
            '_TypeHierarchy': typeHierarchy,
            '$or': [
                { 'State': { '$gt': 'In Dev' } },
                { 'PercentDoneByStoryCount': { '$gte': 1 } }
            ]
        };
    };
}

function HierarchicalRequirement() {
    var typeHierarchy = 'HierarchicalRequirement';
    this.progressPredicate = function() {
        return {
            // Leaf stories in progress
            '_TypeHierarchy': typeHierarchy,
            'ScheduleState': {
                '$gte': 'In-Progress',
                '$lt': 'Accepted'
            },
            'Children': null
        };
    };
    this.completePredicate = function() {
        return {
            // Leaf stories accepted
            '_TypeHierarchy': typeHierarchy,
            'ScheduleState': {
                '$gte': 'Accepted'
            },
            'Children': null
        };
    };
}

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

    config: {
        //Time range is epoch to current month
        startOn: '2011-12',
        endBefore: new Time(new Date()).inGranularity(Time.MONTH).toString(),
        xAxis: 'month',
        type: 'PortfolioItem/Feature'
    },

    constructor: function(config) {
        if (typeof(CustomAppConfig) !== 'undefined') {
            Ext.apply(config, CustomAppConfig);
        }
        this.callParent(arguments);

        this._workspaceConfig = this.getContext().getWorkspace().WorkspaceConfiguration;

        this._xAxisStrategies = {
            'fiscalQuarter': new FiscalQuarters(this.getStartOn(), this.getEndBefore(), this._workspaceConfig.TimeZone),
            'month': new Months(this.getStartOn(), this.getEndBefore(), this._workspaceConfig.TimeZone),
            'storyPoints': new StoryPoints(),
            'featureSize': new FeatureSize(),
            'quarter': new Quarters(this.getStartOn(), this.getEndBefore(), this._workspaceConfig.TimeZone)
        };

        this._xAxisStrategy = this._xAxisStrategies[this.getXAxis()];

        //Force type based on xAxis value
        if (this.getXAxis() === 'storyPoints') {
            this.setType('HierarchicalRequirement');
        }
        if (this.getXAxis() === 'featureSize') {
            this.setType('PortfolioItem/Feature');
        }

        this._typeStrategies = {
            'PortfolioItem/Feature': new Feature(),
            'HierarchicalRequirement': new HierarchicalRequirement()
        };

        this._typeStrategy = this._typeStrategies[this.getType()];

        this._parseHangmanVariablesFromQueryString();
        this._showChart();

        Deft.Promise.all([
            this._getTISCSnapshots(),
            this._getCompletedOids()
        ]).then({
            success: Ext.bind(this._onLoad, this)
        });
    },

    launch: function() {
        //launch gets called *before* constructor???
        //well played AppSDK. well played.
        //see constructor for the real launching of things...
    },

    _onLoad: function(loaded) {
        var snapshots = loaded[0];
        var completedOids = loaded[1];

        var tiscResults = this._getTISCResults(snapshots);

        var convertTicksToHours = Ext.bind(function(row) {
            return row.ticks / this._workDayHours;
        }, this);

        var getCategory = Ext.bind(function(row) {
            return this._xAxisStrategy.categorize(row);
        }, this);

        var deriveFieldsOnOutput = Ext.Array.map([25, 50, 75], function(percentile) {
            var p = Lumenize.functions.percentileCreator(percentile);
            return {
                field: "timeInProcessP" + percentile,
                f: function(row) {
                    return p(row.hours_values);
                }
            };
        });

        var cube = new OLAPCube({
            deriveFieldsOnInput: [
                { field: "hours", f: convertTicksToHours },
                { field: "category", f: getCategory }
            ],
            metrics: [
                { field: "hours", f: "values" },
                { field: "hours", f: "average", as: "timeInProcessAverage" }
            ],
            deriveFieldsOnOutput: deriveFieldsOnOutput,
            dimensions: [
                { field: "category" }
            ]
        });

        var tiscResultsFilteredByCompletion = Ext.Array.filter(tiscResults, function(result) {
            return !!completedOids[result.ObjectID];
        });

        cube.addFacts(tiscResultsFilteredByCompletion);

        this._showChartData(cube);
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
    
    _getTISCSnapshots: function() {
        var deferred = new Deft.Deferred();
        Ext.create('Rally.data.lookback.SnapshotStore', {
            autoLoad : true,
            listeners: {
                load: function(store, models) {
                    //Extract the raw snapshot data...
                    var snapshots = Ext.Array.map(models, function(model){
                        return model.data;
                    });
                    deferred.resolve(snapshots);
                }
            },
            fetch: ['ObjectID', '_ValidTo', '_ValidFrom'].concat(this._xAxisStrategy.field),
            find: this._getProjectScopedQuery(Ext.merge({
                '_ValidFrom': {
                    '$gte': this.getStartOn(),
                    '$lt': this.getEndBefore()
                }
            }, this._typeStrategy.progressPredicate()))
        });
        return deferred.getPromise();
    },

    _getCompletedOids: function(type, afterCompletedOIDs){
        var deferred = new Deft.Deferred();
        Ext.create('Rally.data.lookback.SnapshotStore', {
            autoLoad : true,
            listeners: {
                load: function(store, models) {
                    //Build map of completed oids
                    var completedOids = {};
                    Ext.each(models, function(model) {
                        completedOids[model.data.ObjectID] = true;
                    });
                    deferred.resolve(completedOids);
                }
            },
            fetch: ['ObjectID'],
            find: this._getProjectScopedQuery(Ext.merge({
                '__At': this.getEndBefore()
            }, this._typeStrategy.completePredicate()))
        });
        return deferred.getPromise();
    },

    _getTISCResults: function(snapshots) {
        var config = {
            granularity: 'hour',
            tz: this._workspaceConfig.TimeZone,
            workDays: this._workspaceConfig.WorkDays.split(','),
            endBefore: this.getEndBefore(),

            // assume 9-5
            workDayStartOn: {hour: 9, minute: 0},
            workDayEndBefore: {hour: 17, minute: 0},

            holidays: this._federalHolidays(),

            trackLastValueForTheseFields: [this._xAxisStrategy.field]
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
        tisc.addSnapshots(snapshots, this.getStartOn(), this.getEndBefore());

        return tisc.getResults();
    },

    _showChart : function() {
        var chart = this.down("#chart1");
        chart.removeAll();
        
        this._extChart = Ext.create('Rally.ui.chart.Chart', {
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
                    text: 'Time in Process'
                },                        
                xAxis: {
                    tickInterval : 1,
                    title: {
                        text: this._xAxisStrategy.label
                    }
                },
                yAxis: [{
                    title: {
                        text: 'Time in Process (days)'
                    },
                    plotLines: [{
                        value: 0,
                        width: 1,
                        color: '#808080'
                    }]
                }],
                tooltip: {
                    valueSuffix : ' days',
                    shared: true
                },
                legend: {
                    align: 'center',
                    verticalAlign: 'bottom'
                }
            }
        });
        chart.add(this._extChart);
    },

    _showChartData: function(cube) {
        var categories = this._xAxisStrategy.categories;

        var timeInProcessMedian = _.map(categories, function(category) {
            var cell = cube.getCell({ category: category });
            return cell ? cell.timeInProcessP50 : null;
        });
        var timeInProcessError = _.map(categories, function(category) {
            var cell = cube.getCell({ category: category });
            if (cell) {
                return { low: cell.timeInProcessP25, y: cell.timeInProcessP75, high: cell.timeInProcessP75 };
            } else {
                return null;
            }
        });

        //Call _unmask() because setLoading(false) doesn't work
        this._extChart._unmask();

        //Grab the chart's chart's chart
        var chart = this._extChart.down('highchart').chart;

        //Now we have the nice highcharts interface we all know and love
        chart.xAxis[0].setCategories(categories, true);
        chart.addSeries({
            name: 'Time in Process (Median)',
            data: timeInProcessMedian,
            color: this._extChart.chartColors[0]
        });
        chart.addSeries({
            type: 'errorbar',
            name: 'Time in Process (P25/P75)',
            data: timeInProcessError
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
