'use strict';

var net = require('net');
var events = require('events');

exports.connect = function(options, cb) {
    var ads = getAdsObject(options);
    ads.connect(cb);
    return ads;
};

var getAdsObject = function(options) {
    var ads = {};
    ads.options = parseOptions(options);
    ads.invokeId = 1;

    ads.adsClient = {
        connect: function(cb) { 
            return connect.call(ads, cb); 
        },
        end: function() { 
            return end.apply(ads); 
        },
        gethandle: function(adsname, adslength, propname) { 
            return gethandle.apply(ads, [adsname, adslength, propname]);
        },
        readDeviceInfo: function() {
            return readDeviceInfo.apply(ads);
        },
        get options() { return ads.options; },
        set options(v) { ads.options = v; }
    };

    return ads.adsClient;
};

var parseOptions = function(options) {
    return options;
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
        console.log(data.toString());
        this.emit('test');
    });
};


var end = function() {
    if (this.tcpClient) {
        this.tcpClient.end();
    }
};

var adsHandle = {
    adsname: null,
    adslength: null
};

//gethandle('.varname", BYTE, 'value');
//gethandle('.mystruct', [INT, BYTE], ['var1', 'var2']);
var gethandle = function(adsname, adslength, propname) {
    var handle = Object.create(adsHandle);
    handle.adsname = adsname;
    handle.adslength = adslength;

    if (propname instanceof Array) {
        for (var prop in propname) {
            handle[prop] = null;
        }
    } else {
        handle[propname] = null;
    }

    return handle;
};

var readDeviceInfo = function() {
    var buf = new Buffer(1);

    var options = {
        commandId: 1,
        data: buf
    };
    buf = addCommandHeader.call(this, options);
    console.log(buf);
    //this.tcpClient.write(buf, function(){});
};

var addCommandHeader = function(options) {
    var headerSize = 38;
    var size = headerSize + options.data.length;
    var offset = 0;

    var header = new Buffer(headerSize);

    //2 bytes resserver (=0)
    header.writeUInt16LE(0, offset);
    offset += 2;

    //4 bytes length
    header.writeUInt32LE(size, offset);
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
    console.log(options.commandId);
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

    //4 bytes: error code
    header.writeUInt32LE(this.invokeId++, offset);
    offset += 4;

    var buf = new Buffer(size);
    header.copy(buf, 0, 0);
    options.data.copy(buf, headerSize, 0);

    return buf;
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

