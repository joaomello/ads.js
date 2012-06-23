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
var colors = require('colors');

exports.connect = function(options, cb) {
    var adsClient = getAdsObject(options);
    adsClient.connect(cb);
    return adsClient;
};

var getAdsObject = function(options) {
    //var ads = Object.create(emitter.prototype);
    //emitter.call(ads);
    var ads = {};
    ads.options = parseOptions(options);
    ads.invokeId = 0;
    ads.pending = [];

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
    if (this.tcpClient) {
        this.tcpClient.end();
    }
};

var analyseResponse = function(data) {
    var tcpHeaderSize = 6;
    var headerSize = 32;
    var commandId = data.readUInt16LE(22);
    var length = data.readUInt32LE(26);
    var error = data.readUInt32LE(30);
    var invokeId = data.readUInt32LE(34);

    var cb = this.pending[invokeId];

    if (!cb) { 
        throw "Recieved a response,  but I can't find the request"; 
    }

    console.log('received command ' + commandId + ' id ' + invokeId);
    logPackage(data);

    data = data.slice(tcpHeaderSize + headerSize);
    switch (commandId) { 
        case 1: 
            getDeviceInfoResult.call(this, data, cb);
            break;
        case 2:
            getReadResult.call(this, data, cb);
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
        readCommand.call(ads, 0x0000F005, handle.symhandle, handle.totalByteLength, function(result) {
            integrateResultInHandle(handle, result);
            cb.call(ads.adsClient, handle);
        });
    });  
};

var getHandle = function(handle, cb) {
    var ads = this;
    handle = parseHandle(handle);
    var buf = stringToBuffer(handle.symname);

    //TODO keep a list and get only when needed

    writeReadCommand.call(ads, 0x0000F003, 0x00000000, buf, 4, function(result) {

        handle.symhandle = result.readUInt32LE(0);

        cb.call(ads, handle);
    });

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

var writeCommand = function() {
    
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

    console.log("sending command " +  options.commandId + " id " + this.invokeId);
    logPackage(buf);
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

    cb.call(this.adsClient, result); //TODO
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
    for(var i=0;i<handle.propname.length;i++) {
        l = handle.bytelength[i].length; //TODO numbers
        //var buf = result.slice(prevLength, l);
        var value = null;

        //TODO case tyoe
        value = result.readUInt16LE(offset);

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
    } else throw "The handle doesn't have a propname property!";

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
    } else throw "The handle doesn't have a byteLength property!";

    return handle;
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


var adsType = {
    length: 1
};

function makeType(name, length) {
    var t = Object.create(adsType);
    t.length = length;
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

    if (length !== undefined) {
        t.length = arguments[0];
    }
    return t;
};

var logPackage = function(buf) {

    //console.log(buf);
};