'use strict';

var fs = require('fs');
var async = require('async');
var log = require('gracelog');
var er = require('./error');

var ER = {
	DUP_NAME: 'DUPLICATE_MODULE_NAME',
	DUP_PATH: 'DUPLICATE_MODULE_PATH',
	LOAD_ERR: 'MODULE_LOAD_ERROR',
	MOD_NOT_FOUND: 'MODULE_NOT_FOUND',
	MISSING_CONFIG_FUNC: 'MISSING_CONFIG_FUNCTION',
	MISSING_CONFIG: 'MISSING_CONFIG'
};

var logger;
var pathList = [];
var pending = {};

exports.use = function (name, pathOrMod, options) {
	if (pending[name]) {
		throw er.create(
			ER.DUP_NAME, name +
			': ' +
			'[' + pathOrMod + '] & ' +
			'[' + pending[name].path + ']'
		);
	}
	if (pathList.indexOf(pathOrMod) !== -1) {
		throw er.create(
			ER.DUP_PATH, name +
			': ' +
			((typeof pathOrMod !== 'stirng') ? '[module object]' : pathOrMod)
		);
	}
	if (!options) {
		options = {};
	}
	pending[name] = {
		path: pathOrMod,
		config: options.config || null,
		setup: options.setup || null,
		exit: options.exit || null
	};
	pathList.push(pathOrMod);
};

exports.start = function (gn, configMap, onExit, cb) {
	logger = log.create('module');
	var keys = Object.keys(pending);
	var handle = function (key, next) {
		var start = Date.now();
		var item = pending[key];
		if (typeof item.path !== 'string') {
			setupMod(configMap, onExit, key, item.path, function (error) {
				if (error) {
					return next(error);
				}
				var modName = createModName(key);
				gn.mod[modName] = item.path;
				logger.info(
					'Bootstrapped a module:',
					'gracenode.mod.' + modName,
					'[', key, ']',
					((typeof item.path !== 'string') ? '[module object]' : item.path),
					'[time:' + (Date.now() - start) + 'ms]'
				);
				next();
			});
			return;
		}
		logger.verbose('Bootstrapping a module:', key, item.path);
		start = Date.now();
		fs.exists(item.path, function (exists) {
			if (!exists) {
				return next(
					er.create(
						ER.MOD_NOT_FOUND, key + ': ' + item.path
					)
				);
			}
			var mod = require(item.path);
			// if custom .config() is present, override/add it
			if (typeof item.config === 'function') {
				mod.configCustom = function (configIn) {
					item.config.apply(mod, [configIn]);
				};
				logger.verbose('Custom', key + '.config() found');
			}
			// if custom .setup(<callback>) is present, override/add it
			if (typeof item.setup === 'function') {
				mod.setupCustom = function (cb) {
					item.setup.apply(mod, [cb]);
				};
				logger.verbose('Custom', key + '.setup(<callback>) found');
			}
			// if custom .exit(<callback>) is present, override/add it
			if (typeof item.exit === 'function') {
				mod.exitCustom = function (cb) {
					item.exit.apply(mod, [cb]);
				};
				logger.verbose('Custom', key + '.exit(<callback>) found');
			}
			setupMod(configMap, onExit, key, mod, function (error) {
				if (error) {
					return next(error);
				}
				var modName = createModName(key);
				gn.mod[modName] = mod;
				logger.info(
					'Bootstrapped a module:',
					'gracenode.mod.' + modName,
					'[', key, ']',
					item.path,
					'[time:' + (Date.now() - start) + 'ms]'
				);
				next();
			});
		});
	};
	var done = function (error) {
		pathList = [];
		pending = {};
		if (error) {
			return cb(error);
		}
		logger.info('Bootstrapping modules completed');
		cb(null);
	};
	async.eachSeries(keys, handle, done);
};

function setupMod(configMap, onExit, key, mod, cb) {
	// setup on exit function of the module
	var func = null;
	if (mod.exitCustom) {
		func = mod.exitCustom;
	} else if (mod.exit) {
		func = mod.exit;
	}
	if (typeof func === 'function') {
		logger.verbose(key + '.exit(<callback>) has been assigned to process exit:', key);
		onExit(func);
	}
	readModConfig(configMap, key, mod, function (error) {
		if (error) {
			return cb(error);
		}
		callModSetup(key, mod, cb);
	});
}

function readModConfig(configMap, key, mod, cb) {
	var config = configMap[key] || null;
	// reaConfig is gracenode 1.x
	var func = null;
	if (mod.configCustom) {
		func = mod.configCustom;
	} else if (mod.config) {
		func = mod.config;
	} else if (mod.readConfig) {
		func = mod.readConfig;
	}
	logger.verbose(
		'Reading ' + key + ' configuration:',
		(config ? true : false),
		key + '.config():', (func ? true : false)
	);
	if (config && !func) {
		return cb(er.create(ER.MISSING_CONFIG_FUNC, key));
	} else if (!config && func) {
		return cb(er.create(ER.MISSING_CONFIG, key));
	} else if (!config && !func) {
		return cb();
	}
	// read config
	func(config);
	// done
	cb();
}

function callModSetup(key, mod, cb) {
	var func = null;
	if (mod.setupCustom) {
		func = mod.setupCustom;
	} else if (mod.setup) {
		func = mod.setup;
	}
	if (!func) {
		return cb();
	}
	logger.verbose('Calling ' + key + '.setup(<callback>)');
	func(cb);
}

function createModName(name) {
	var sep = name.split('-');
	var camelCased = sep[0];
	for (var i = 1, len = sep.length; i < len; i++) {
		var firstChar = sep[i].substring(0, 1).toUpperCase();
		camelCased += firstChar + sep[i].substring(1);
	}
	return camelCased;
}
