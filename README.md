Feature Time in Process Chart
=========================

## Overview

This app creates a column chart of the 80th percentile Time-in-Process of Features for each fiscal quarter. Currently project scope down is assumed.

## Build it

1. Install [Node.js](http://nodejs.org) and add ```./node_modules/.bin``` to your ```PATH```.
1. Clone this repo and change directory to where you checked out the repo
1. Run ```npm install```, then ```rally-app-builder build```. Your app will be in the *deploy* folder.

## Configuration

Define a global object called ```CustomAppConfig``` before the app launches, like this:

```
var CustomAppConfig = {
	xAxis: 'quarters',              //Allowed values: 'months', 'quarters', 'fiscalQuarters', 'storyPoints', 'featureSize'
	type: 'PortfolioItem/Feature'   //Allowed values: 'PortfolioItem/Feature', 'HierarchicalRequirement'
};
```

## License

AppTemplate is released under the MIT license.  See the file [LICENSE](https://raw.github.com/RallyApps/AppTemplate/master/LICENSE) for the full text.
