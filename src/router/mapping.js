'use strict';

var url = require('./url');
var hooks = require('./hooks');
var gn = require('../gracenode');
var logger;

var PARAM_NAME_REGEX = /{(.*?)}/g;
var PARAM_REGEX = /\/{(.*?)}/g;
var BRACE_REGEX = /({|})/g;
var TYPES = [
	'string',
	'number',
	'bool',
	'object'
];

// routes (shortcuts) with named parameters
var routes = {
	GET: {},
	POST: {},
	PUT: {},
	DELETE: {},
	PATCH: {}
};

// all routes with named parameters
var allroutes = {
	GET: [],
	POST: [],
	PUT: [],
	DELETE: [],
	PATCH: []
};

// routes without named parameters
var fastroutes = {
	GET: {},
	POST: {},
	PUT: {},
	DELETE: {},
	PATCH: {}
};

exports.setup = function () {
	logger = gn.log.create('router.mapping');
};

exports.hook = function (path, handler) {
	hooks.hook(path, handler);
	hooks.updateHooks(fastroutes, routes, allroutes);
};

exports.add = function (method, path, handler, opt) {
	// head is treated as get
	method = method === 'HEAD' ? 'GET' : method;
	// always leading slash
	if (path[0] !== '/') {
		path = '/' + path;
	}
	// no trailing slash
	if (path.length > 1 && path[path.length - 1] === '/') {
		path = path.substring(0, path.length - 1);
	}
	// option defaults
	opt = opt || {
		readBody: method !== 'GET' ? true : false,
		sensitive: false
	};
	// convert path to regex
	var converted = url.convert(path, opt.sensitive);
	// fast route w/o named parameters
	if (converted.fast) {
		return addToFastRoutes(method, path, handler, opt);
	}
	// route w/ named parameters
	addToRoutes(method, path, handler, opt, converted);
};

exports.getRoute = function (method, path) {
	// try fast route first
	var fast = searchFastRoute(method, path);
	if (fast) {
		return {
			matched: [],
			route: {
				path: fast.path,
				paramNames: [],
				handler: fast.handler,
				hooks: fast.hooks,
				readBody: fast.readBody,
				sensitive: fast.sensitive
			}
		};
	}
	// try routes
	var found = searchRoute(method, path);
	if (!found || !found.matched) {
		return null;
	}
	return found;
};

function addToFastRoutes(method, path, handler, opt) {
	var key = !opt.sensitive ? path.toLowerCase() : path;
	fastroutes[method][key] = {
		path: path,
		paramNames: null,
		handler: handler,
		hooks: hooks.findHooks(path),
		readBody: opt.readBody,
		sensitive: opt.sensitive
	};
}

function addToRoutes(method, path, handler, opt, conv) {
	// add to routes
	var key = getRouteKey(path);
	if (!routes[method][key]) {
		routes[method][key] = [];
	}
	var lkey = key.toLowerCase();
	if (!routes[method][lkey]) {
		routes[method][lkey] = [];
	}
	var regex = opt.sensitive ? new RegExp(conv.pmatch) : new RegExp(conv.pmatch, 'i');
	var route = {
		path: path.replace(PARAM_REGEX, ''),
		pattern: conv.pmatch,
		regex: regex,
		extract: conv.extract,
		paramNames: getParamNames(path),
		handler: handler,
		hooks: hooks.findHooks(path),
		readBody: opt.readBody
	};
	routes[method][key].push(route);
	// re-order route list from long uri to short uri
	routes[method][key].sort(function (a, b) {
		return b.pattern.length - a.pattern.length;
	});
	routes[method][lkey] = routes[method][key];
	// add the route to all routes also
	allroutes[method].push(route);
	// re-order all routes
	allroutes[method].sort(function (a, b) {
		return b.pattern.length - a.pattern.length;
	});
}

function searchFastRoute(method, path) {
	if (path === '/' && fastroutes[method]) {
		return fastroutes[method][path] || null;
	}
	if (path[path.length - 1] === '/') {
		path = path.substring(0, path.length - 1);
	}
	var map = fastroutes[method] || {};
	// try case sensitive
	if (map[path]) {
		return map[path];
	}
	// try case insensitive
	var lpath = path.toLowerCase();
	var match = map[lpath];
	if (match && match.sensitive) {
		return null;
	}
	return match;
}

function searchRoute(method, path) {
	if (!routes[method]) {
		logger.error(method, 'not supported');
		return null;
	}
	var key = getRouteKey(path);
	var list = routes[method][key];
	if (!list) {
		return searchAllRoutes(method, path);
	}
	var found = searchRouteShortcut(path, list);
	if (!found) {
		logger.debug('Route not found for:', path, 'in', list);
		return null;
	}
	return found;
}

function searchRouteShortcut(path, list) {
	for (var i = 0, len = list.length; i < len; i++) {
		var item = list[i];
		var found = item.regex.test(path);
		if (found) {
			return {
				matched: item.extract.exec(path),
				route: item
			};
		}
	}
	return null;
}

function searchAllRoutes(method, path) {
	var list = allroutes[method];
	for (var i = 0, len = list.length; i < len; i++) {
		var item = list[i];
		var found = item.regex.test(path);
		if (found) {
			return {
				matched: item.extract.exec(path),
				route: item
			};
		}
	}
	return null;
}

function getRouteKey(path) {
	var key = path.substring(1);
	return key.substring(0, key.indexOf('/'));
}

function getParamNames(path) {
	var list = path.match(PARAM_NAME_REGEX);
	var res = [];
	if (list) {
		for (var i = 0, len = list.length; i < len; i++) {
			var sep = list[i].replace(BRACE_REGEX, '').split(':');
			var type;
			var name;
			if (sep.length === 2) {
				type = sep[0];
				if (TYPES.indexOf(type) === -1) {
					throw new Error('InvalidType: ' + type);
				}
				name = sep[1];
			} else {
				type = null;
				name = sep[0];
			}
			res.push({
				type: type,
				name: name
			});
		}
	}
	return res;
}