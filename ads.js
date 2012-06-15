var net = require('net');  //https://github.com/joyent/node/blob/master/lib/net.js
var events = require('events');


exports.connect = function(options, cb) {
    var ads = getAdsObject(options);
    ads.connect(cb);
    return ads;
};

var getAdsObject = function(options) {
    var that = this;
    this.options = parseOptions(options);

    return {
        connect: function(cb) { adsConnect.call(that, cb); },
        end: function() { adsEnd.apply(that); },
        get options() { return that.options; },
        set options(v) { that.options = v; }
    };
};

var parseOptions = function(options) {
    return options;
};

var adsConnect = function(cb) {
    this.client = net.connect(
        this.options.port, 
        this.options.host, 
        cb);

    this.client.on('data', function(data) {
        console.log(data.toString());
        this.emit('test');
    });
};


var adsEnd = function() {
    if (this.client) {
        this.client.end();
    }
};


/*
var adsPackage = {};
var adsTcpHeader = Object.create(adsPackage);
var adsHeader = Object.create(adsTcpHeader);
var adsCommand = Object.create(adsHeader);
var adsCommandReadDeviceInfo = Object.Create(adsCommand);
var adsCommandRead = Object.Create(adsCommand);
var adsCommandWrite = Object.Create(adsCommand);
var adsCommandReadState = Object.Create(adsCommand);
var adsCommandWriteControl = Object.Create(adsCommand);
var adsCommandAddDeviceNotification = Object.Create(adsCommand);
var adsCommandDeleteDeviceNotification = Object.Create(adsCommand);
var adsCommandDeviceNotification = Object.Create(adsCommand);
var adsCommandReadWrite = Object.Create(adsCommand);
*/

var adsHandle = {
    adsname: null,
    adslength: null,
    _symhandle: null
};

//gethandle('.varname", BYTE, 'value');
//gethandle('.mystruct', [INT, BYTE], ['var1', 'var2']);
exports.gethandle = function(adsname, adslength, propname) {
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

