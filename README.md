ads.js
======

A NodeJS implementation for the Twincat ADS protocol.  
(Twincat and ADS is from Beckhoff &copy;. I'm not affiliated.)


Examples
--------

### Hello PLC

```javascript
var ads = require('./ads.js');

var options = {
    //The IP or hostname of the target machine
    host: "10.0.0.2", 
    //The NetId of the target machine
    amsNetIdTarget: "5.1.204.160.1.1",
    //The NetId of the source machine.
    //You can choose anything in the form of x.x.x.x.x.x,
    //but on the target machine this must be added as a route.
    amsNetIdSource: "192.168.137.50.1.1",
};

ads.connect(options, function(){
    this.readDeviceInfo(function(result) {
        console.log(result);
    });
});
```

### Read something

```javascript
var testHandle = {
    //Handle name 
    symname: '.testvar',  
    //An ads type object or an array of type objects or just a number
    //You can also specify a number or an array of numbers,
    //the result will then be a Buffer.
    bytelength: ads.INT,  
    //The propery name where the value should be written.
    //This can be an array with the same length as the array length of byteLength.      
    propname: 'value'      
};

client = ads.connect(options, function(){
    this.read(testHandle, function(result){
        //result is the testHandle object with the new properties filled in
        console.log(result);
    });

});
```


License (MIT)
-------------
Copyright (c) 2012 Roeland Moors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

