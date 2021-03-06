'use strict';

// a map of hook functions that maps to command IDs
var hooks = {};
// a list of functions that hooks to all commands
var allHooks = [];

// cmdIdList can be the handler function and handler function can be undefined in that case
// if cmdIdList is not provided, the handler function is to be hooked to all command functions
module.exports.add = function __udpHooksAdd(cmdIdList, handler) {
    if (typeof cmdIdList === 'function') {
        // hook to all command functions
        allHooks.push(cmdIdList);
        return;
    }
    if (typeof handler !== 'function') {
        throw new Error('UDPCommandHookHandlerMustBeFunction');
    }
    if (!Array.isArray(cmdIdList)) {
        cmdIdList = [cmdIdList];
    }
    for (var i = 0, len = cmdIdList.length; i < len; i++) {
        if (!hooks[cmdIdList[i]]) {
            hooks[cmdIdList[i]] = [];
        }
        hooks[cmdIdList[i]].push(handler);
    }
};

module.exports.findByCmdId = function __udpHooksFindByCmdId(cmdId) {
    var list = allHooks.concat([]);
    var matched = hooks[cmdId] || [];
    return list.concat(matched);    
};
