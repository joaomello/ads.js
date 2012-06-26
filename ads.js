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


//TODO
//
// code cleanup: command params as object, check if callback exists
//
// implement all ads features
//
// Cluster?
//
// Seperate app: redis(log with TTL) + socket.io
//
// check if callback exists
//



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

    ads.adsClient.end = function() { 
        return end.call(ads); 
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

    this.tcpClient.on('data', function(data) {
        analyseResponse.call(that, data);
    });

    this.tcpClient.on('timeout', function(data) {
        that.adsClient.emit('timeout', data);
        that.tcpClient.end();
    });

    this.tcpClient.on('error', function(data) {
        that.adsClient.emit('error', data);
        that.tcpClient.end();
    });
};


var end = function() {
    releaseSymHandles.call(this, function(){
        releaseNotificationHandles.call(this, function() {
            if (this.tcpClient) {
                this.tcpClient.end();
            }         
        });
    });
};

var ID_NOTIFICATION = 8;

var analyseResponse = function(data) {
    var tcpHeaderSize = 6;
    var headerSize = 32;
    var commandId = data.readUInt16LE(22);
    var length = data.readUInt32LE(26);
    var error = data.readUInt32LE(30);
    var invokeId = data.readUInt32LE(34);

    var cb = this.pending[invokeId];

    if ((!cb) && (commandId !== ID_NOTIFICATION)) { 
        throw "Recieved a response,  but I can't find the request"; 
    }

    logPackage("receiving", data, commandId, invokeId);

    data = data.slice(tcpHeaderSize + headerSize);
    switch (commandId) { 
        case 1: 
            getDeviceInfoResult.call(this, data, cb);
            break;
        case 2:
            getReadResult.call(this, data, cb);
            break;
        case 3:
            getWriteResult.call(this, data, cb);
            break;
        case 4:
            //readState.call(this, data, cb);
            break;
        case 5:
            //writeControl.call(this, data, cb);
            break;
        case 6:
            getAddDeviceNotificationResult.call(this, data, cb);
            break;
        case 7:
            getDeleteDeviceNotificationResult.call(this, data, cb);
            break;
        case ID_NOTIFICATION:
            getNotificationResult.call(this, data, cb);
            break;
        case 9:
            getWriteReadResult.call(this, data, cb);
            break;
        default: 
            throw 'Unknown command';
    }
    
    //that.emit('test');
};

/////////////////////// ADS FUNCTIONS ///////////////////////

var readDeviceInfo = function(cb) {
    var buf = new Buffer(0);

    var options = {
        commandId: 1,
        data: buf,
        cb: cb
    };
    runCommand.call(this, options); 
};

var read = function(handle, cb) {
    var ads = this;
    getHandle.call(ads, handle, function(handle) {
        readCommand.call(ads, 0x0000F005, handle.symhandle, 
                         handle.totalByteLength, function(result) {
            integrateResultInHandle(handle, result);
            cb.call(ads.adsClient, handle);
        });
    });  
};

var write = function(handle, cb) {
    var ads = this;
    getHandle.call(ads, handle, function(handle) {
        getBytesFromHandle(handle);
        writeCommand.call(ads, 0x0000F005, handle.symhandle, handle.totalByteLength, 
                          handle.bytes, function(result) {
            cb.call(ads.adsClient);
        });
    });  
};

var notify = function(handle, cb) {
    var ads = this;
    getHandle.call(ads, handle, function(handle) {
        addNotificationCommand.call(ads, 0x0000F005, handle.symhandle, handle.totalByteLength, 
                          handle.transmissionMode, handle.maxDelay, handle.cycleTime,
                          function(notificationHandle) {
            this.notifications[notificationHandle] = handle;
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

        writeReadCommand.call(ads, 0x0000F003, 0x00000000, buf, 4, function(result) {

            ads.symHandlesToRelease.push(result);
            handle.symhandle = result.readUInt32LE(0);

            cb.call(ads, handle);
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
    writeCommand.call(this, 0x0000F006, 0x00000000, symhandle.length, symhandle, function(){
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

var readCommand = function(indexGroup, indexOffset, bytelength, cb) {
    var buf = new Buffer(12);
    buf.writeUInt32LE(indexGroup, 0);
    buf.writeUInt32LE(indexOffset, 4);
    buf.writeUInt32LE(bytelength, 8); 

    var options = {
        commandId: 2,
        data: buf,
        cb: cb
    };
    runCommand.call(this, options); 
};

var writeCommand = function(indexGroup, indexOffset, bytelength, bytes, cb) {
    var buf = new Buffer(12 + bytelength);
    buf.writeUInt32LE(indexGroup, 0);
    buf.writeUInt32LE(indexOffset, 4);
    buf.writeUInt32LE(bytelength, 8); 
    bytes.copy(buf, 12);

    var options = {
        commandId: 3,
        data: buf,
        cb: cb
    };
    runCommand.call(this, options);     
};

var addNotificationCommand = function(indexGroup, indexOffset, bytelength, transmissionMode, 
                             maxDelay, cycleTime, cb) {
    var buf = new Buffer(40);
    buf.writeUInt32LE(indexGroup, 0);
    buf.writeUInt32LE(indexOffset, 4);
    buf.writeUInt32LE(bytelength, 8); 
    buf.writeUInt32LE(transmissionMode, 12); 
    buf.writeUInt32LE(maxDelay, 16); 
    buf.writeUInt32LE(cycleTime*10000, 20); 
    buf.writeUInt32LE(0, 24); 
    buf.writeUInt32LE(0, 28); 
    buf.writeUInt32LE(0, 32); 
    buf.writeUInt32LE(0, 36); 

    var options = {
        commandId: 6,
        data: buf,
        cb: cb
    };
    runCommand.call(this, options);     
};

var writeReadCommand = function(indexGroup, indexOffset, writeBuffer, readLength, cb) {
    var buf = new Buffer(16 + writeBuffer.length);
    buf.writeUInt32LE(indexGroup, 0);
    buf.writeUInt32LE(indexOffset, 4);
    buf.writeUInt32LE(readLength, 8); 
    buf.writeUInt32LE(writeBuffer.length, 12); 
    writeBuffer.copy(buf, 16);

    var options = {
        commandId: 9,
        data: buf,
        cb: cb
    };
    runCommand.call(this, options); 
};

var deleteDeviceNotificationCommand = function(notificationHandle, cb) {
    var buf = new Buffer(4);
    buf.writeUInt32LE(notificationHandle, 0);

    var options = {
        commandId: 7,
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

    logPackage("sending", buf, options.commandId, this.invokeId);
    this.tcpClient.write(buf);
};

///////////////////// COMMAND RESULT PARSING ////////////////////////////

var getDeviceInfoResult = function(data, cb){
    var adsError = data.readUInt32LE(0);

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
    var bytelength = data.readUInt32LE(4);
    var result = new Buffer(bytelength);
    data.copy(result, 0, 8, 8 + bytelength);
    cb.call(this, result);
};

var getWriteReadResult = function(data, cb) {
    var adsError = data.readUInt32LE(0);
    var bytelength = data.readUInt32LE(4);
    var result = new Buffer(bytelength);
    data.copy(result, 0, 8, 8 + bytelength);
    cb.call(this, result);
};

var getWriteResult = function(data, cb) {
    var adsError = data.readUInt32LE(0);
    cb.call(this);
};

var getAddDeviceNotificationResult = function(data, cb) {
    var adsError = data.readUInt32LE(0);
    var notificationHandle = data.readUInt32LE(4);
    this.notificationsToRelease.push(notificationHandle);
    cb.call(this, notificationHandle);
};

var getDeleteDeviceNotificationResult = function(data, cb) {
    var adsError = data.readUInt32LE(0);
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
            var handle = this.notifications[notiHandle];
            integrateResultInHandle(handle, buf);
            this.adsClient.emit("notification", handle);
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
    if (!options.port) { options.port = 48898; }
    if (!options.amsPortSource) { options.amsPortSource = 32905; }
    if (!options.amsPortTarget) { options.amsPortTarget = 801; }
    return options;
};

var integrateResultInHandle = function(handle, result) {
    var offset = 0;
    var l = 0;
    var convert = { isAdsType: false};
    for(var i=0;i<handle.propname.length;i++) {
        l = getItemByteLength(handle.bytelength[i], convert);

        var value = result.slice(offset, l);

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
                    //TODO
                    break;
            }
        }

        handle[handle.propname[i]] = value;

        offset = l;

    }
};

var parseHandle = function(handle){
    if (typeof handle.symname === 'undefined') {
        console.log(handle);
        throw "The handle doesn't have a symname property!";    
    }

    if (typeof handle.propname !== 'undefined') {
        if (!Array.isArray(handle.propname)) {
            handle.propname = [handle.propname];
        }
    } else handle.propname = ['value'];

    if (typeof handle.bytelength !== 'undefined') {
        if (!Array.isArray(handle.bytelength)) {
            handle.bytelength = [handle.bytelength];
        }

        handle.totalByteLength = 0;
        for (var i=0; i<handle.bytelength.length; i++) {
             if (typeof handle.bytelength[i]  === 'number') {
                handle.totalByteLength += handle.bytelength[i];        
            }
            if (typeof handle.bytelength[i]  === 'object') {
                handle.totalByteLength += handle.bytelength[i].length;       
            }
        }
    } else handle.totalByteLength = [exports.BOOL];

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


var logPackage = function(info, buf, commandId, invokeId) {
    while (info.length < 10) info = info + " ";

    console.log(info + " -> commandId: " +  commandId + ", invokeId: " + invokeId);
    //console.log(buf);
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