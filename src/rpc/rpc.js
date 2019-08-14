'use strict';

const neti = require('os').networkInterfaces();
const net = require('net');
const gn = require('../gracenode');

const connection = require('./connection');
const router = require('./router');
const hooks = require('./hooks');
const transport = require('../../lib/transport');
const protocol = require('../../lib/packet/protocol');

var logger;
var config;
const cryptoEngine = {
    encrypt: null,
    decrypt: null
};
var formatFunction;
var shutdown = false;
var server;
const conns = {};

const IPv4 = 'ipv4';
const DEFAULT_NETWORKINTERFACE = 'eth0';
const LOCALHOST = '127.0.0.1';
const PORT_IN_USE = 'EADDRINUSE';
const TIMEOUT_FOR_CLOSE = 5000;
const HEARTBEAT_ID =  911;
const HEARTBEAT_NAME = 'heartbeat';
const LAST_RANGE = 1000;
const connectionInfo = {
    host: null,
    port: null,
    family: null
};

module.exports.name = 'rpc';

module.exports.info = function __rpcInfo() {
    return {
        address: connectionInfo.address,
        host: connectionInfo.host,
        port: connectionInfo.port,
        family: connectionInfo.family
    };
};

module.exports.shutdown = function () {
    return shutdown;
};

module.exports.setup = function __rpcSetup(cb) {
    if (gn.isCluster() && gn.isMaster()) {
        return cb();
    }
    logger = gn.log.create('RPC');
    config = gn.getConfig('rpc');
    if (!gn.isSupportedVersion()) {
        return gn.stop(new Error(
            'RPC server does not support node.js version: ' + process.version
        ));
    }
    // gracenode shutdown task
    gn.onExit(function RPCShutdown(next) {
        shutdown = true;
        logger.info(
            'RPC server closing',
            config.host + ':' + config.port,
            'waiting for all open connections to close...'
        );
        logger.info(
            'RPC server will forcefully close if all connections do not close in',
            TIMEOUT_FOR_CLOSE, 'msc'
        );
        // set up time out if connections do not close within the time, it hard closes
        const timeout = setTimeout(next, TIMEOUT_FOR_CLOSE);
        // stop accepting new connections and shutdown when all connections are closed
        // server will emit 'close' event when closeAllConnections finishes
        server.close();
        // instruct all connections to close
        closeAllConnections(function () {
            clearTimeout(timeout);
            next();
        });
    });
    // if manual start is enabled
    if (config.manualStart) {
        logger.info('RPC server must be started manually by gracenode.manualStart([ gracenode.rpc ], callback)');
        return cb();
    }
    module.exports.startModule(cb);
};

module.exports.startModule = function (cb) {
    if (gn.isCluster() && gn.isMaster()) {
        return cb();
    }

    connection.setup();

    // change default max size for packets
           if (config.maxPayloadSize) {
        transport.setMaxSize(config.maxPayloadSize);
    }

    protocol.setup(gn);

    if (config && config.port) {
        config.portRange = [
            config.port,
            config.port + LAST_RANGE
        ];
    }

    if (!config || !config.portRange) {
        return cb();
    }

    if (!Array.isArray(config.portRange) || config.portRange.length < 1) {
        logger.error(
            'incorrect port range',
            '(must be an array of 1 elements from smallest to biggest):',
            config.portRange
        );
        throw new Error('<PORT_RANGE_FOR_RPC_SERVER_INCORRECT>');
    }

    // if config.host is not provided, dynamically obtain the host address
    // for now we support IPv4 ONLY...
    var addrMap = findAddrMap();

    logger.info('Available Addresses:', addrMap);

    if (!config.nic) {
        config.nic = DEFAULT_NETWORKINTERFACE;
    }

    if (!config.host) {
        logger.info('Obtaining the address dynamically from network interface', config.nic);
        if (!addrMap[config.nic]) {
            logger.info('Network interface', config.nic, 'not found falling back to localhost');
        }
        config.host = addrMap[config.nic] || LOCALHOST;
    }

    // set up RPC command controller router
    router.setup();

    var ports = [];
    var portIndex = 0;
    var boundPort;
    var pend = config.portRange[1] || config.portRange[0];

    for (var p = config.portRange[0]; p <= pend; p++) {
        ports.push(p);
    }

    logger.verbose('port range is', config.portRange[0], 'to', pend);

    var done = function __rpcSetupDone() {
        // RPC server is now successfully bound and listening
        boundPort = ports[portIndex];
        const info = server.address();
        connectionInfo.address = info.address;
        connectionInfo.host = config.host;
        connectionInfo.port = boundPort;
        connectionInfo.family = info.family;

        // if heartbeat is required, set it up here now
        if (gn.getConfig('rpc.heartbeat')) {
            /*
            rpc.heartbeat: {
                timeout: [milliseconds] // time to timeout and disconnect w/o heartbeat from client,
                checkFrequency: [milliseconds] // heartbeat check internval
            }
            */
            try {
                router.define(HEARTBEAT_ID, HEARTBEAT_NAME, handleHeartbeat);
            } catch (e) {
                logger.warn(e);
            }
        }

        connection.useCryptoEngine(cryptoEngine);

        logger.info('RPC server started at', config.host + ':' + boundPort, connectionInfo.family);
        logger.info('using encryption:', (cryptoEngine.encrypt ? true : false));
        logger.info('using decryption:', (cryptoEngine.decrypt ? true : false));

        cb();
    };
    var listen = function __rpcListen() {
        const port = ports[portIndex];
        logger.verbose('binding to:', config.host + ':' + port);
        server.listen({
            port: port,
            host: config.host,
            // make sure all workers do NOT share the same port
            exclusive: true
        });
    };
    server = net.createServer(handleConn, function (socket) {
        socket.setNoDelay(!!config.noDelay);
    });
    server.on('listening', done);
    server.on('error', function __rpcOnError(error) {
        if (error.code === PORT_IN_USE) {
            // try next port in range
            var badPort = ports[portIndex];
            logger.verbose('port is in use:', badPort);
            portIndex += 1;
            if (!ports[portIndex]) {
                // there's no more port in range
                error.message += ' (port:' + badPort + ')';
                return gn.stop(error);
            }
            return listen();
        }
        // different error, stop gracenode
        gn.stop(error);
    });
    // start listening
    listen();
};

module.exports.getCommandList = function () {
    return router.getCommandList();
};

module.exports.requireCallback = function __rpcReqCb(timeout) {
    connection.requireCallback(timeout);
};

module.exports.useEncryption = function __rpcUseEncryption(encrypt) {
    if (typeof encrypt !== 'function') {
        throw new Error('EncryptMustBeFunction');
    }
    cryptoEngine.encrypt = encrypt;
};

module.exports.useDecryption = function __rpcUseDecryption(decrypt) {
    if (typeof decrypt !== 'function') {
        throw new Error('DecryptMustBeFunction');
    }
    cryptoEngine.decrypt = decrypt;
};

// assign a handler function to a command
module.exports.command = function __rpcCommand(cmdId, commandName, handler) {
    router.define(cmdId, commandName, handler);
};

// assign a command hook function
module.exports.hook = function __rpcHook(cmdIdList, handler) {
    if (typeof cmdIdList === 'function') {
        hooks.add(cmdIdList);
        return;
    }
    // cmdIdList can contain command names instead of command IDs
    cmdIdList = router.getIdsByNames(cmdIdList);
    hooks.add(cmdIdList, handler);
};

module.exports.onClosed = function __rpcOnClosed(func) {
    module.exports._onClosed = func;
};

module.exports.onKilled = function __rpcOnKilled(func) {
    module.exports._onKilled = func;
};

module.exports._onClosed = function __rpcOnClosedExec() {

};

module.exports._onKilled = function __rpcOnKilledExec() {

};

module.exports.setHeartbeatResponseFormat = function __rpcSetHeartbeatResFormat(_formatFunction) {
    if (typeof _formatFunction !== 'function') {
        throw new Error('RPCHeartbeatFormatFunctionMustBeAFunction');
    }
    formatFunction = _formatFunction;
};

function handleHeartbeat(state, cb) {
    if (formatFunction) {
        const formatted = formatFunction(res);
        if (formatted) {
            return cb(formatted);
        }
    }
    var res = gn.Buffer.alloc(JSON.stringify({
        message: 'heartbeat',
        serverTime: gn.lib.now()
    }));
    cb(res);
}

function handleConn(sock) {
    if (sock.remotePort <= 0 || sock.remotePort > 65536) {
        logger.error(
            'invalid and/or malformed incoming TCP packet:',
            sock.remoteAddress, sock.remotePort,
            'kill connection'
        );
        sock.destory();
        return;
    }
    var conn = connection.create(sock);
    conn.on('clear', onConnectionClear);

    conns[conn.id] = conn;

    logger.sys(
        'new TCP connection (id:', conn.id, ') from:',
        sock.remoteAddress, ':', sock.remotePort
    );
}

function onConnectionClear(killed, connId) {
    try {
        if (killed) {
            if (typeof module.exports._onKilled === 'function') {
                module.exports._onKilled(connId);
            }
        } else {
            if (typeof module.exports._onClosed === 'function') {
                module.exports._onClosed(connId);
            }
        }
    } catch (error) {
        logger.error('RPC server failed to handle clearing TCP connection object:', error);
    }
    delete conns[connId];
}

function closeAllConnections(cb) {
    for (const connId in conns) {
        if (conns[connId]) {
            logger.info('closing a TCP connection: (ID:' + connId + ')');
            conns[connId].close();
        }
    }
    server.on('close', cb);
}

function findAddrMap() {
    var map = {};
    for (var interfaceName in neti) {
        var list = neti[interfaceName];
        for (var i = 0, len = list.length; i < len; i++) {
            var fam = list[i].family.toLowerCase();
            var addr = list[i].address;
            if (fam === IPv4) {
                map[interfaceName] = addr;
            }
        }
    }
    return map;
}

