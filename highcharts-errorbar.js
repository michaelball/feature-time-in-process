// ==ClosureCompiler==
// @compilation_level SIMPLE_OPTIMIZATIONS

/**
 * @license Highcharts JS v3.0.2 (2013-06-05)
 *
 * (c) 2009-2013 Torstein Hønsi
 *
 * License: www.highcharts.com/license
 */

// JSLint options:
/*global Highcharts, HighchartsAdapter, document, window, navigator, setInterval, clearInterval, clearTimeout, setTimeout, location, jQuery, $, console */

(function (Highcharts, UNDEFINED) {
var arrayMin = Highcharts.arrayMin,
	arrayMax = Highcharts.arrayMax,
	each = Highcharts.each,
	extend = Highcharts.extend,
	merge = Highcharts.merge,
	map = Highcharts.map,
	pick = Highcharts.pick,
	pInt = Highcharts.pInt,
	defaultPlotOptions = Highcharts.getOptions().plotOptions,
	seriesTypes = Highcharts.seriesTypes,
	extendClass = Highcharts.extendClass,
	splat = Highcharts.splat,
	wrap = Highcharts.wrap,
	Axis = Highcharts.Axis,
	Tick = Highcharts.Tick,
	Series = Highcharts.Series,
	colProto = seriesTypes.column.prototype,
	math = Math,
	mathRound = math.round,
	mathFloor = math.floor,
	mathCeil = math.ceil,
	mathMin = math.min,
	mathMax = math.max,
	noop = function () {};

/* ****************************************************************************
 * Start Box plot series code											      *
 *****************************************************************************/

// Set default options
defaultPlotOptions.boxplot = merge(defaultPlotOptions.column, {
	fillColor: '#FFFFFF',
	lineWidth: 1,
	//medianColor: null,
	medianWidth: 2,
	states: {
		hover: {
			brightness: -0.3
		}
	},
	//stemColor: null,
	//stemDashStyle: 'solid'
	//stemWidth: null,
	threshold: null,
	tooltip: {
		pointFormat: '<span style="color:{series.color};font-weight:bold">{series.name}</span><br/>' +
			'Minimum: {point.low}<br/>' +
			'Lower quartile: {point.q1}<br/>' +
			'Median: {point.median}<br/>' +
			'Higher quartile: {point.q3}<br/>' +
			'Maximum: {point.high}<br/>'
	},
	//whiskerColor: null,
	whiskerLength: '50%',
	whiskerWidth: 2
});

// Create the series object
seriesTypes.boxplot = extendClass(seriesTypes.column, {
	type: 'boxplot',
	pointArrayMap: ['low', 'q1', 'median', 'q3', 'high'], // array point configs are mapped to this
	toYData: function (point) { // return a plain array for speedy calculation
		return [point.low, point.q1, point.median, point.q3, point.high];
	},
	pointValKey: 'high', // defines the top of the tracker
	
	/**
	 * One-to-one mapping from options to SVG attributes
	 */
	pointAttrToOptions: { // mapping between SVG attributes and the corresponding options
		fill: 'fillColor',
		stroke: 'color',
		'stroke-width': 'lineWidth'
	},
	
	/**
	 * Disable data labels for box plot
	 */
	drawDataLabels: noop,

	/**
	 * Translate data points from raw values x and y to plotX and plotY
	 */
	translate: function () {
		var series = this,
			yAxis = series.yAxis,
			pointArrayMap = series.pointArrayMap;

		seriesTypes.column.prototype.translate.apply(series);

		// do the translation on each point dimension
		each(series.points, function (point) {
			each(pointArrayMap, function (key) {
				if (point[key] !== null) {
					point[key + 'Plot'] = yAxis.translate(point[key], 0, 1, 0, 1);
				}
			});
		});
	},

	/**
	 * Draw the data points
	 */
	drawPoints: function () {
		var series = this,  //state = series.state,
			points = series.points,
			options = series.options,
			chart = series.chart,
			renderer = chart.renderer,
			pointAttr,
			q1Plot,
			q3Plot,
			highPlot,
			lowPlot,
			medianPlot,
			crispCorr,
			crispX,
			graphic,
			stemPath,
			stemAttr,
			boxPath,
			whiskersPath,
			whiskersAttr,
			medianPath,
			medianAttr,
			width,
			left,
			right,
			halfWidth,
			shapeArgs,
			color,
			doQuartiles = series.doQuartiles !== false, // error bar inherits this series type but doesn't do quartiles
			whiskerLength = parseInt(series.options.whiskerLength, 10) / 100;

		each(points, function (point) {

			graphic = point.graphic;
			shapeArgs = point.shapeArgs; // the box
			stemAttr = {};
			whiskersAttr = {};
			medianAttr = {};
			color = point.color || series.color;
			if (point.plotY !== UNDEFINED) {

				pointAttr = point.pointAttr[point.selected ? 'selected' : ''];

				// crisp vector coordinates
				width = shapeArgs.width;
				left = mathFloor(shapeArgs.x);
				right = left + width;
				halfWidth = mathRound(width / 2);
				//crispX = mathRound(left + halfWidth) + crispCorr;
				q1Plot = mathFloor(doQuartiles ? point.q1Plot : point.lowPlot);// + crispCorr;
				q3Plot = mathFloor(doQuartiles ? point.q3Plot : point.lowPlot);// + crispCorr;
				highPlot = mathFloor(point.highPlot);// + crispCorr;
				lowPlot = mathFloor(point.lowPlot);// + crispCorr;
				
				// Stem attributes
				stemAttr.stroke = point.stemColor || options.stemColor || color;
				stemAttr['stroke-width'] = pick(point.stemWidth, options.stemWidth, options.lineWidth);
				stemAttr.dashstyle = point.stemDashStyle || options.stemDashStyle;
				
				// Whiskers attributes
				whiskersAttr.stroke = point.whiskerColor || options.whiskerColor || color;
				whiskersAttr['stroke-width'] = pick(point.whiskerWidth, options.whiskerWidth, options.lineWidth);
				
				// Median attributes
				medianAttr.stroke = point.medianColor || options.medianColor || color;
				medianAttr['stroke-width'] = pick(point.medianWidth, options.medianWidth, options.lineWidth);
				
				
				// The stem
				crispCorr = (stemAttr['stroke-width'] % 2) / 2;
				crispX = left + halfWidth + crispCorr;				
				stemPath = [
					// stem up
					'M',
					crispX, q3Plot,
					'L',
					crispX, highPlot,
					
					// stem down
					'M',
					crispX, q1Plot,
					'L',
					crispX, lowPlot,
					'z'
				];
				
				// The box
				if (doQuartiles) {
					crispCorr = (pointAttr['stroke-width'] % 2) / 2;
					crispX = mathFloor(crispX) + crispCorr;
					q1Plot = mathFloor(q1Plot) + crispCorr;
					q3Plot = mathFloor(q3Plot) + crispCorr;
					left += crispCorr;
					right += crispCorr;
					boxPath = [
						'M',
						left, q3Plot,
						'L',
						left, q1Plot,
						'L',
						right, q1Plot,
						'L',
						right, q3Plot,
						'L',
						left, q3Plot,
						'z'
					];
				}
				
				// The whiskers
				if (whiskerLength) {
					crispCorr = (whiskersAttr['stroke-width'] % 2) / 2;
					highPlot = highPlot + crispCorr;
					lowPlot = lowPlot + crispCorr;
					whiskersPath = [
						// High whisker
						'M',
						crispX - halfWidth * whiskerLength, 
						highPlot,
						'L',
						crispX + halfWidth * whiskerLength, 
						highPlot,
						
						// Low whisker
						'M',
						crispX - halfWidth * whiskerLength, 
						lowPlot,
						'L',
						crispX + halfWidth * whiskerLength, 
						lowPlot
					];
				}
				
				// The median
				crispCorr = (medianAttr['stroke-width'] % 2) / 2;				
				medianPlot = mathRound(point.medianPlot) + crispCorr;
				medianPath = [
					'M',
					left, 
					medianPlot,
					'L',
					right, 
					medianPlot,
					'z'
				];
				
				// Create or update the graphics
				if (graphic) { // update
					
					point.stem.animate({ d: stemPath });
					if (whiskerLength) {
						point.whiskers.animate({ d: whiskersPath });
					}
					if (doQuartiles) {
						point.box.animate({ d: boxPath });
					}
					point.medianShape.animate({ d: medianPath });
					
				} else { // create new
					point.graphic = graphic = renderer.g()
						.add(series.group);
					
					point.stem = renderer.path(stemPath)
						.attr(stemAttr)
						.add(graphic);
						
					if (whiskerLength) {
						point.whiskers = renderer.path(whiskersPath) 
							.attr(whiskersAttr)
							.add(graphic);
					}
					if (doQuartiles) {
						point.box = renderer.path(boxPath)
							.attr(pointAttr)
							.add(graphic);
					}	
					point.medianShape = renderer.path(medianPath)
						.attr(medianAttr)
						.add(graphic);
				}
			}
		});

	}


});

/* ****************************************************************************
 * End Box plot series code												*
 *****************************************************************************/
/* ****************************************************************************
 * Start error bar series code                                                *
 *****************************************************************************/

// 1 - set default options
defaultPlotOptions.errorbar = merge(defaultPlotOptions.boxplot, {
	color: '#000000',
	grouping: false,
	linkedTo: ':previous',
	tooltip: {
		pointFormat: defaultPlotOptions.arearange.tooltip.pointFormat
	},
	whiskerWidth: null
});

// 2 - Create the series object
seriesTypes.errorbar = extendClass(seriesTypes.boxplot, {
	type: 'errorbar',
	pointArrayMap: ['low', 'high'], // array point configs are mapped to this
	toYData: function (point) { // return a plain array for speedy calculation
		return [point.low, point.high];
	},
	pointValKey: 'high', // defines the top of the tracker
	doQuartiles: false,

	/**
	 * Get the width and X offset, either on top of the linked series column
	 * or standalone
	 */
	getColumnMetrics: function () {
		return (this.linkedParent && this.linkedParent.columnMetrics) || 
			seriesTypes.column.prototype.getColumnMetrics.call(this);
	}
});

/* ****************************************************************************
 * End error bar series code                                                  *
 *****************************************************************************/

}(Highcharts));
