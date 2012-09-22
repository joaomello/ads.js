// Copyright (c) 2012 Roeland Moors

// Permission is hereby granted, free of charge, to any person obtaining a 
// copy of this software and associated documentation files (the "Software"), 
// to deal in the Software without restriction, including without limitation 
// the rights to use, copy, modify, merge, publish, distribute, sublicense, 
// and/or sell copies of the Software, and to permit persons to whom the 
// Software is furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in 
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR 
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE 
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, 
// ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
// DEALINGS IN THE SOFTWARE.

'use strict';

var net = require('net');
var events = require('events');
var buf = require('buffer');
buf.INSPECT_MAX_BYTES = 200;

exports.connect = function(options, cb) {
    var adsClient = getAdsObject(options);
    adsClient.connect(cb);
    return adsClient;
};

var getAdsObject = function(options) {
    var ads = {};
    ads.options = parseOptions(options);
    ads.invokeId = 0;
    ads.pending = [];
    ads.symHandlesToRelease = [];
    ads.notificationsToRelease = [];
    ads.notifications = {};

    var emitter = new events.EventEmitter();
    ads.adsClient = Object.create(emitter);

    ads.adsClient.connect = function(cb) { 
        return connect.call(ads, cb); 
    };

    ads.adsClient.end = function(cb) { 
        return end.call(ads, cb); 
    };

    ads.adsClient.readDeviceInfo = function(cb) {
        return readDeviceInfo.call(ads, cb);
    };

    ads.adsClient.read = function(handle, cb) {
        return read.call(ads, handle, cb);
    };

    ads.adsClient.write = function(handle, cb) {
        return write.call(ads, handle, cb);
    };

    ads.adsClient.notify = function(handle, cb) {
        return notify.call(ads, handle, cb);
    };

    Object.defineProperty(ads.adsClient, "options", {
        get options() { return ads.options; },
        set options(v) { ads.options = v; }
    });
        
    return ads.adsClient;
};

var connect = function(cb) {
    var that = this;

    this.tcpClient = net.connect(
        this.options.port, 
        this.options.host, 
        function(){
            cb.apply(that.adsClient);
        }
    );

    //this.tcpClient.setKeepAlive(true);

    this.tcpClient.on('data', function(data) {
        analyseResponse.call(that, data);
    });

    this.tcpClient.on('timeout', function(data) {
        that.adsClient.emit('timeout', data);
        that.tcpClient.end();
    });

    this.dataCallback = function(data) {
        that.adsClient.emit('error', data);
        that.tcpClient.end();
    };

    this.tcpClient.on('error', this.dataCallback);
};


var end = function(cb) {
    this.tcpClient.removeListener('data', this.dataCallback);
    releaseSymHandles.call(this, function(){
        releaseNotificationHandles.call(this, function() {
            if (this.tcpClient) {
                this.tcpClient.end();
            }  
            if (cb !== undefined) cb.call(this);     
        });
    });
};

var ID_READ_DEVICE_INFO = 1;
var ID_READ = 2;
var ID_WRITE = 3;
var ID_READ_STATE = 4;
var ID_WRITE_CONTROL = 5;
var ID_ADD_NOTIFICATION = 6;
var ID_DEL_NOTIFICATION = 7;
var ID_NOTIFICATION = 8;
var ID_READ_WRITE = 9;

var analyseResponse = function(data) {
    var tcpHeaderSize = 6;
    var headerSize = 32;
    var commandId = data.readUInt16LE(22);
    var length = data.readUInt32LE(26);
    var error = data.readUInt32LE(30);
    var invokeId = data.readUInt32LE(34);

    logPackage.call(this, "receiving", data, commandId, invokeId);

    emitAdsError.call(this, error);

    var cb = this.pending[invokeId];

    if ((!cb) && (commandId !== ID_NOTIFICATION)) { 
        throw "Recieved a response,  but I can't find the request"; 
    }

    data = data.slice(tcpHeaderSize + headerSize);
    switch (commandId) { 
        case ID_READ_DEVICE_INFO: 
            getDeviceInfoResult.call(this, data, cb);
            break;
        case ID_READ:
            getReadResult.call(this, data, cb);
            break;
        case ID_WRITE:
            getWriteResult.call(this, data, cb);
            break;
        case ID_READ_STATE:
            //readState.call(this, data, cb);
            break;
        case ID_WRITE_CONTROL:
            //writeControl.call(this, data, cb);
            break;
        case ID_ADD_NOTIFICATION:
            getAddDeviceNotificationResult.call(this, data, cb);
            break;
        case ID_DEL_NOTIFICATION:
            getDeleteDeviceNotificationResult.call(this, data, cb);
            break;
        case ID_NOTIFICATION:
            getNotificationResult.call(this, data);
            break;
        case ID_READ_WRITE:
            getWriteReadResult.call(this, data, cb);
            break;
        default: 
            throw 'Unknown command';
    }
};

/////////////////////// ADS FUNCTIONS ///////////////////////

var readDeviceInfo = function(cb) {
    var buf = new Buffer(0);

    var options = {
        commandId: ID_READ_DEVICE_INFO,
        data: buf,
        cb: cb
    };
    runCommand.call(this, options); 
};

var read = function(handle, cb) {
    var ads = this;
    getHandle.call(ads, handle, function(handle) {

        var commandOptions = {
            indexGroup: 0x0000F005,
            indexOffset: handle.symhandle,
            bytelength: handle.totalByteLength,
            symname: handle.symnane,
        };

        readCommand.call(ads, commandOptions, function(result) {
            integrateResultInHandle(handle, result);
            cb.call(ads.adsClient, handle);
        });
    });  
};

var write = function(handle, cb) {
    var ads = this;
    getHandle.call(ads, handle, function(handle) {
        getBytesFromHandle(handle);
        var commandOptions = {
            indexGroup: 0x0000F005,
            indexOffset: handle.symhandle,
            bytelength: handle.totalByteLength,
            bytes: handle.bytes,
            symname: handle.symname,
        };
        writeCommand.call(ads, commandOptions, function(result) {
            cb.call(ads.adsClient);
        });
    });  
};

var notify = function(handle, cb) {
    var ads = this;
    getHandle.call(ads, handle, function(handle) {
        var commandOptions = {
            indexGroup: 0x0000F005,
            indexOffset: handle.symhandle,
            bytelength: handle.totalByteLength,
            transmissionMode: handle.transmissionMode, 
            maxDelay: handle.maxDelay, 
            cycleTime: handle.cycleTime,
            symname: handle.symname,
        };
        addNotificationCommand.call(ads, commandOptions, function(notiHandle) {
            if (ads.options.verbose > 0) {
                console.log("Add notiHandle " + notiHandle);
            }

            this.notifications[notiHandle] = handle;
            if (typeof cb !== 'undefined') {
                cb.call(ads.adsClient);
            } 
        });
    });  
};

var getHandle = function(handle, cb) {
    var ads = this;
    handle = parseHandle(handle);
    var buf = stringToBuffer(handle.symname);

    if (typeof handle.symhandle === 'undefined') {

        var commandOptions = {
            indexGroup: 0x0000F003,
            indexOffset: 0x00000000,
            writeBuffer: buf,
            readLength: 4,
            symname: handle.symname,
        };

        writeReadCommand.call(ads, commandOptions, function(result) {

            if (result.length > 0) {
                ads.symHandlesToRelease.push(result);
                handle.symhandle = result.readUInt32LE(0);
                cb.call(ads, handle);
            //} else {
            //    ads.adsClient.emit('error', new Error("Empty handle result!"));
            }
        });
    } else cb.call(ads, handle);

};

var releaseSymHandles = function(cb) {
    var ads = this;
    if (this.symHandlesToRelease.length > 0) {
        var symHandle = this.symHandlesToRelease.shift();
        releaseSymHandle.call(this, symHandle, function() {
            releaseSymHandles.call(ads, cb);
        });
    } else cb.call(this);
};

var releaseSymHandle = function(symhandle, cb) {
    var ads = this;
    var commandOptions = {
        indexGroup: 0x0000F006,
        indexOffset: 0x00000000,
        bytelength: symhandle.length,
        bytes: symhandle
    };
    writeCommand.call(this, commandOptions, function(){
        cb.call(ads);    
    });
};

var releaseNotificationHandles = function(cb) {
    var ads = this;
    if (this.notificationsToRelease.length > 0) {
        var notificationHandle = this.notificationsToRelease.shift();
        deleteDeviceNotificationCommand.call(this, notificationHandle, function() {
            releaseNotificationHandles.call(ads, cb);
        });
    } else cb.call(this);
};


//////////////////////// COMMANDS ///////////////////////

var readCommand = function(commandOptions, cb) {
    var buf = new Buffer(12);
    buf.writeUInt32LE(commandOptions.indexGroup, 0);
    buf.writeUInt32LE(commandOptions.indexOffset, 4);
    buf.writeUInt32LE(commandOptions.bytelength, 8); 

    var options = {
        commandId: ID_READ,
        data: buf,
        cb: cb,
        symname: commandOptions.symname,
    };
    runCommand.call(this, options); 
};

var writeCommand = function(commandOptions, cb) {
    var buf = new Buffer(12 + commandOptions.bytelength);
    buf.writeUInt32LE(commandOptions.indexGroup, 0);
    buf.writeUInt32LE(commandOptions.indexOffset, 4);
    buf.writeUInt32LE(commandOptions.bytelength, 8); 
    commandOptions.bytes.copy(buf, 12);

    var options = {
        commandId: ID_WRITE,
        data: buf,
        cb: cb,
        symname: commandOptions.symname,
    };
    runCommand.call(this, options);     
};

var addNotificationCommand = function(commandOptions, cb) {
    var buf = new Buffer(40);
    buf.writeUInt32LE(commandOptions.indexGroup, 0);
    buf.writeUInt32LE(commandOptions.indexOffset, 4);
    buf.writeUInt32LE(commandOptions.bytelength, 8); 
    buf.writeUInt32LE(commandOptions.transmissionMode, 12); 
    buf.writeUInt32LE(commandOptions.maxDelay, 16); 
    buf.writeUInt32LE(commandOptions.cycleTime*10000, 20); 
    buf.writeUInt32LE(0, 24); 
    buf.writeUInt32LE(0, 28); 
    buf.writeUInt32LE(0, 32); 
    buf.writeUInt32LE(0, 36); 

    var options = {
        commandId: ID_ADD_NOTIFICATION,
        data: buf,
        cb: cb,
        symname: commandOptions.symname,
    };
    runCommand.call(this, options);     
};

var writeReadCommand = function(commandOptions, cb) {
    var buf = new Buffer(16 + commandOptions.writeBuffer.length);
    buf.writeUInt32LE(commandOptions.indexGroup, 0);
    buf.writeUInt32LE(commandOptions.indexOffset, 4);
    buf.writeUInt32LE(commandOptions.readLength, 8); 
    buf.writeUInt32LE(commandOptions.writeBuffer.length, 12); 
    commandOptions.writeBuffer.copy(buf, 16);

    var options = {
        commandId: ID_READ_WRITE,
        data: buf,
        cb: cb,
        symname: commandOptions.symname,
    };
    runCommand.call(this, options); 
};

var deleteDeviceNotificationCommand = function(notificationHandle, cb) {
    var buf = new Buffer(4);
    buf.writeUInt32LE(notificationHandle, 0);

    var options = {
        commandId: ID_DEL_NOTIFICATION,
        data: buf,
        cb: cb
    };
    runCommand.call(this, options); 
};

var runCommand = function(options) {
    var tcpHeaderSize = 6;
    var headerSize = 32;
    var offset = 0;

    if (!options.cb) {
        throw "A command needs a callback function!";
    }

    var header = new Buffer(headerSize + tcpHeaderSize);

    //2 bytes resserver (=0)
    header.writeUInt16LE(0, offset);
    offset += 2;

    //4 bytes length
    header.writeUInt32LE(headerSize + options.data.length, offset);
    offset += 4;
    
    //6 bytes: amsNetIdTarget
    var amsNetIdTarget = this.options.amsNetIdTarget.split('.');
    for (var i=0; i<amsNetIdTarget.length;i++)
    {
        if (i>=6) { throw "Incorrect amsNetIdTarget length!"; }
        amsNetIdTarget[i] = parseInt(amsNetIdTarget[i], 10);
        header.writeUInt8(amsNetIdTarget[i], offset);
        offset++;
    }

    //2 bytes: amsPortTarget
    header.writeUInt16LE(this.options.amsPortTarget, offset);
    offset += 2;

    //6 bytes amsNetIdSource
    var amsNetIdSource = this.options.amsNetIdSource.split('.');
    for (i=0; i<amsNetIdSource.length;i++)
    {
        if (i>=6) { throw "Incorrect amsNetIdSource length!"; }
        amsNetIdSource[i] = parseInt(amsNetIdSource[i], 10);
        header.writeUInt8(amsNetIdSource[i], offset);
        offset++;
    }

    //2 bytes: amsPortTarget
    header.writeUInt16LE(this.options.amsPortSource, offset);
    offset += 2;
    
    //2 bytes: Command ID
    header.writeUInt16LE(options.commandId, offset);
    offset += 2;

    //2 bytes: state flags (ads request tcp)
    header.writeUInt16LE(4, offset);
    offset += 2;

    //4 bytes: length of the data
    header.writeUInt32LE(options.data.length, offset);
    offset += 4;

    //4 bytes: error code
    header.writeUInt32LE(0, offset);
    offset += 4;

    //4 bytes: invoke id
    header.writeUInt32LE(++this.invokeId, offset);
    offset += 4;

    var buf = new Buffer(tcpHeaderSize + headerSize + options.data.length);
    header.copy(buf, 0, 0);
    options.data.copy(buf, tcpHeaderSize + headerSize, 0);

    this.pending[this.invokeId] = options.cb;

    logPackage.call(this, "sending", buf, options.commandId, this.invokeId, options.symname);
    this.tcpClient.write(buf);
};

///////////////////// COMMAND RESULT PARSING ////////////////////////////

var getDeviceInfoResult = function(data, cb){
    var adsError = data.readUInt32LE(0);
    emitAdsError.call(this, adsError);

    var result = {
        majorVersion: data.readUInt8(4),
        minorVersion: data.readUInt8(5),
        versionBuild: data.readUInt16LE(6),
        deviceName: data.toString('utf8', 8, findStringEnd(data, 8))
    };

    cb.call(this.adsClient, result); 
};

var getReadResult = function(data, cb) {
    var adsError = data.readUInt32LE(0);
    emitAdsError.call(this, adsError);
    var bytelength = data.readUInt32LE(4);
    var result = new Buffer(bytelength);
    data.copy(result, 0, 8, 8 + bytelength);
    cb.call(this, result);
};

var getWriteReadResult = function(data, cb) {
    var adsError = data.readUInt32LE(0);
    emitAdsError.call(this, adsError);
    var bytelength = data.readUInt32LE(4);
    var result = new Buffer(bytelength);
    data.copy(result, 0, 8, 8 + bytelength);
    cb.call(this, result);
};

var getWriteResult = function(data, cb) {
    var adsError = data.readUInt32LE(0);
    emitAdsError.call(this, adsError);
    cb.call(this);
};

var getAddDeviceNotificationResult = function(data, cb) {
    var adsError = data.readUInt32LE(0);
    emitAdsError.call(this, adsError);
    var notificationHandle = data.readUInt32LE(4);
    this.notificationsToRelease.push(notificationHandle);
    cb.call(this, notificationHandle);
};

var getDeleteDeviceNotificationResult = function(data, cb) {
    var adsError = data.readUInt32LE(0);
    emitAdsError.call(this, adsError);
    cb.call(this);
};

var getNotificationResult = function(data) {
    var length = data.readUInt32LE(0);
    var stamps = data.readUInt32LE(4);
    var offset = 8;
    var timestamp = 0;
    var samples = 0;
    var notiHandle = 0;
    var size = 0;

    for (var i=0;i<stamps;i++) {
        timestamp = data.readUInt32LE(offset); //TODO 8 bytes and convert
        offset += 8;
        samples = data.readUInt32LE(offset);
        offset += 4;
        for (var j=0;j<samples;j++) {
            notiHandle = data.readUInt32LE(offset);
            offset += 4;
            size = data.readUInt32LE(offset);
            offset += 4;
            var buf = new Buffer(size);
            data.copy(buf, 0, offset);
            offset += size;

            if (this.options.verbose > 0) {
                console.log("Get notiHandle " + notiHandle);
            }

            var handle = this.notifications[notiHandle];

            //It can happen that there is a notification before I
            //even have the notification handle.
            //In that case I just skip this notification.
            if (handle !== undefined) {
                integrateResultInHandle(handle, buf);
                this.adsClient.emit("notification", handle);
            } else {
                if (this.options.verbose > 0) {
                    console.log("skipping notification " + notiHandle);
                }    
            }
        }
    }
};

//////////////////// HELPERS /////////////////////////////////////////

var stringToBuffer = function(someString) {
    var buf = new Buffer(someString.length + 1);
    buf.write(someString);
    buf[someString.length] = 0;
    return buf;
};

var parseOptions = function(options) {

    //Defaults
    if (typeof options.port === 'undefined') { 
        options.port = 48898; 
    }

    if (typeof options.amsPortSource === 'undefined') { 
        options.amsPortSource = 32905; 
    }

    if (typeof options.amsPortTarget === 'undefined') { 
        options.amsPortTarget = 801; 
    }

    if (typeof options.host === 'undefined') {
        throw "host not defined!";
    }

    if (typeof options.amsNetIdTarget === 'undefined') {
        throw "amsNetIdTarget not defined!";
    }

    if (typeof options.amsNetIdSource === 'undefined') {
        throw "amsNetIdTarget not defined!";
    }

    if (options.verbose === undefined) {
        options.verbose = 0;
    }

    return options;
};

var getCommandDescription = function(commandId) {

    var desc = "Unknown command";
    switch (commandId) { 
        case ID_READ_DEVICE_INFO: 
            desc = "Read device info";
            break;
        case ID_READ:
            desc = "Read";
            break;
        case ID_WRITE:
            desc = "Write";
            break;
        case ID_READ_STATE:
            desc = "Read state";
            break;
        case ID_WRITE_CONTROL:
            desc = "Write control";
            break;
        case ID_ADD_NOTIFICATION:
            desc = "Add notification";
            break;
        case ID_DEL_NOTIFICATION:
            desc = "Delete notification";
            break;
        case ID_NOTIFICATION:
            desc = "Notification";
            break;
        case ID_READ_WRITE:
            desc = "ReadWrite";
            break;
    }
    return desc;
};

var integrateResultInHandle = function(handle, result) {
    var offset = 0;
    var l = 0;
    var convert = { isAdsType: false};
    for(var i=0;i<handle.propname.length;i++) {
        l = getItemByteLength(handle.bytelength[i], convert);

        var value = result.slice(offset, offset + l);

        if (convert.isAdsType) {
            switch(handle.bytelength[i].name) {
                case 'BOOL':
                case 'BYTE':
                case 'USINT':
                    value = result.readUInt8(offset);
                    break;
                case 'SINT':
                    value = result.readInt8(offset);
                    break;
                case 'UINT':
                case 'WORD':
                    value = result.readUInt16LE(offset);
                    break;
                case 'INT':
                    value = result.readInt16LE(offset);
                    break;
                case 'DWORD':
                case 'UDINT':
                    value = result.readUInt32LE(offset);
                    break;
                case 'DINT':
                    value = result.readInt32LE(offset);
                    break;
                case 'REAL':
                    value = result.readFloatLE(offset);
                    break;
                case 'LREAL':
                    value = result.readDoubleLE(offset);
                    break;
                case 'TIME':
                case 'TIME_OF_DAY':
                case 'DATE':
                case 'DATE_AND_TIME':
                    var seconds = result.readUInt32LE(offset);
                    value = new Date(seconds * 1000);
                    var timeoffset = value.getTimezoneOffset();
                    value = new Date(value.setMinutes(value.getMinutes() + timeoffset));
                    break;
            }
        }

        handle[handle.propname[i]] = value;

        offset += l;

    }
};

var parseHandle = function(handle){
    if (typeof handle.symname === 'undefined') {
        throw "The handle doesn't have a symname property!";    
    }

    if (typeof handle.propname !== 'undefined') {
        if (!Array.isArray(handle.propname)) {
            handle.propname = [handle.propname];
        }
    } else handle.propname = ['value'];

    if (typeof handle.bytelength === 'undefined') {
        handle.bytelength = [exports.BOOL];
    }

    if (!Array.isArray(handle.bytelength)) {
        handle.bytelength = [handle.bytelength];
    }

    handle.totalByteLength = 0;
    for (var i=0; i<handle.bytelength   .length; i++) {
         if (typeof handle.bytelength[i]  === 'number') {
            handle.totalByteLength += handle.bytelength[i];        
        }
        if (typeof handle.bytelength[i]  === 'object') {
            handle.totalByteLength += handle.bytelength[i].length;       
        }
    }


    if (handle.bytelength.length !== handle.propname.length) {
        throw "The array bytelength and propname should have the same length!";
    }

    if (typeof handle.transmissionMode === 'undefined') {
        handle.transmissionMode = exports.NOTIFY.ONCHANGE;
    }

    if (typeof handle.maxDelay === 'undefined') {
        handle.maxDelay = 0;
    }

    if (typeof handle.cycleTime === 'undefined') {
        handle.cycleTime = 10;
    }

    return handle;
};

var getBytesFromHandle = function(handle) {
    var p = '';
    var buf = new Buffer(handle.totalByteLength);
    var offset = 0;
    var convert = { isAdsType: false };
    var l = 0;
    for (var i=0;i<handle.propname.length;i++) {
        p = handle.propname[i];
        l = getItemByteLength(handle.bytelength[i], convert);

        if (!convert.isAdsType) {
            handle[p].copy(buf, offset);
        }

        if ((typeof handle[p] !== 'undefined') && convert.isAdsType) {
            switch(handle.bytelength[i].name) {
                case 'BOOL':
                case 'BYTE':
                case 'USINT':
                    buf.writeUInt8(handle[p], offset);
                    break;
                case 'SINT':
                    buf.writeInt8(handle[p], offset);
                    break;
                case 'UINT':
                case 'WORD':
                    buf.writeUInt16LE(handle[p], offset);
                    break;
                case 'INT':
                    buf.writeInt16LE(handle[p], offset);
                    break;
                case 'DWORD':
                case 'UDINT':
                    buf.writeUInt32LE(handle[p], offset);
                    break;
                case 'DINT':
                    buf.writeInt32LE(handle[p], offset);
                    break;
                case 'REAL':
                    buf.writeFloatLE(handle[p], offset);
                    break;
                case 'LREAL':
                    buf.writeDoubleLE(handle[p], offset);
                    break;
                case 'TIME':
                case 'TIME_OF_DAY':
                case 'DATE':
                case 'DATE_AND_TIME':
                    //TODO
                    break;
            }
        } else throw 'Property ' + p + ' not available on handle!';
    }

    handle.bytes = buf;
};

var getItemByteLength = function(bytelength, convert) {
    var l = 0;
    if (typeof bytelength === 'number') {
        l = bytelength;
    } else {
        l = bytelength.length; 
        convert.isAdsType = true;
    }
    return l;
};

var findStringEnd = function(data, offset) {
    if (!offset) { offset = 0; }
    var endpos = offset;
    for (var i=offset; i<data.length; i++)
    {
        if (data[i] === 0x00) {
            endpos = i;
            break;
        }
    }
    return endpos;
};


var logPackage = function(info, buf, commandId, invokeId, symname) {
    while (info.length < 10) info = info + " ";

    var msg = info + " -> commandId: " +  commandId;
    msg += ' (' + getCommandDescription(commandId) + ') ';

    msg += ", invokeId: " + invokeId;

    if (symname !== undefined) {
        msg += " symname: " + symname;
    } 

    if (this.options.verbose > 0) {
        console.log(msg);
    }

    if (this.options.verbose > 1) {
        console.log(buf.inspect());
        //console.log(buf);
    }
};

var emitAdsError = function(errorId)  {
    var msg = "";
    if (errorId > 0) {
        switch(errorId) {
            case 1 : msg = "Internal error"; break;
            case 2 : msg = "No Rtime"; break;
            case 3 : msg = "Allocation locked memory error"; break;
            case 4 : msg = "Insert mailbox error"; break;
            case 5 : msg = "Wrong receive HMSG"; break;
            case 6 : msg = "target port not found"; break;
            case 7 : msg = "target machine not found"; break;
            case 8 : msg = "Unknown command ID"; break;
            case 9 : msg = "Bad task ID"; break;
            case 10: msg = "No IO"; break;
            case 11: msg = "Unknown AMS command"; break;
            case 12: msg = "Win 32 error"; break;
            case 13: msg = "Port not connected"; break;
            case 14: msg = "Invalid AMS length"; break;
            case 15: msg = "Invalid AMS Net ID"; break;
            case 16: msg = "Low Installation level"; break;
            case 17: msg = "No debug available"; break;
            case 18: msg = "Port disabled"; break;
            case 19: msg = "Port already connected"; break;
            case 20: msg = "AMS Sync Win32 error"; break;
            case 21: msg = "AMS Sync Timeout"; break;
            case 22: msg = "AMS Sync AMS error"; break;
            case 23: msg = "AMS Sync no index map"; break;
            case 24: msg = "Invalid AMS port"; break;
            case 25: msg = "No memory"; break;
            case 26: msg = "TCP send error"; break;
            case 27: msg = "Host unreachable"; break;
                       
            case 1792: msg="error class <device error>"; break;
            case 1793: msg="Service is not supported by server"; break;
            case 1794: msg="invalid index group"; break;
            case 1795: msg="invalid index offset"; break;
            case 1796: msg="reading/writing not permitted"; break;
            case 1797: msg="parameter size not correct"; break;
            case 1798: msg="invalid parameter value(s)"; break;
            case 1799: msg="device is not in a ready state"; break;
            case 1800: msg="device is busy"; break;
            case 1801: msg="invalid context (must be in Windows)"; break;
            case 1802: msg="out of memory"; break;
            case 1803: msg="invalid parameter value(s)"; break;
            case 1804: msg="not found (files, ...)"; break;
            case 1805: msg="syntax error in command or file"; break;
            case 1806: msg="objects do not match"; break;
            case 1807: msg="object already exists"; break;
            case 1808: msg="symbol not found"; break;
            case 1809: msg="symbol version invalid"; break;
            case 1810: msg="server is in invalid state"; break;
            case 1811: msg="AdsTransMode not supported"; break;
            case 1812: msg="Notification handle is invalid"; break;
            case 1813: msg="Notification client not registered"; break;
            case 1814: msg="no more notification handles"; break;
            case 1815: msg="size for watch too big"; break;
            case 1816: msg="device not initialized"; break;
            case 1817: msg="device has a timeout"; break;
            case 1818: msg="query interface failed"; break;
            case 1819: msg="wrong interface required"; break;
            case 1820: msg="class ID is invalid"; break;
            case 1821: msg="object ID is invalid"; break;
            case 1822: msg="request is pending"; break;
            case 1823: msg="request is aborted"; break;
            case 1824: msg="signal warning"; break;
            case 1825: msg="invalid array index"; break;
            case 1826: msg="symbol not active -> release handle and try again"; break;
            case 1827: msg="access denied"; break;
            case 1856: msg="Error class <client error>"; break;
            case 1857: msg="invalid parameter at service"; break;
            case 1858: msg="polling list is empty"; break;
            case 1859: msg="var connection already in use"; break;
            case 1860: msg="invoke ID in use"; break;
            case 1861: msg="timeout elapsed"; break;
            case 1862: msg="error in win32 subsystem"; break;
            case 1863: msg="Invalid client timeout value"; break;
            case 1864: msg="ads-port not opened"; break;
            case 1872: msg="internal error in ads sync"; break;
            case 1873: msg="hash table overflow"; break;
            case 1874: msg="key not found in hash"; break;
            case 1875: msg="no more symbols in cache"; break;
            case 1876: msg="invalid response received"; break;
            case 1877: msg="sync port is locked"; break;
        }

        var error = new Error(msg);

        this.adsClient.emit('error', error);
    }
};

////////////////////////////// ADS TYPES /////////////////////////////////


var adsType = {
    length: 1,
    name: ''
};

function makeType(name, length) {
    var t = Object.create(adsType);
    t.length = length;
    t.name = name;
    Object.defineProperty(exports, name, {
        value: t,
        writable: false
    });
}

makeType('BOOL', 1);
makeType('BYTE', 1);
makeType('WORD', 2);
makeType('DWORD', 4);
makeType('SINT', 1);
makeType('USINT', 1);
makeType('INT', 2);
makeType('UINT', 2);
makeType('DINT', 4);
makeType('UDINT', 4);
makeType('LINT', 8);
makeType('ULINT', 8);
makeType('REAL', 4);
makeType('LREAL', 8);
makeType('TIME', 4);
makeType('TIME_OF_DAY', 4);
makeType('DATE', 4);
makeType('DATE_AND_TIME', 4);

exports.string = function(length) {
    var t = {
        length: 81
    };

    if (typeof length !== undefined) {
        t.length = arguments[0];
    }
    return t;
};

exports.NOTIFY = {
    CYCLIC: 3,
    ONCHANGE: 4
};