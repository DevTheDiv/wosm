import fsp from "fs/promises";
import fs from "fs";
import exp from "constants";

// take a look at the file
// https://www.npmjs.com/package/stream-json

// Creating a readable stream from file 
// readline module reads line by line  

async function parseRegFile(_file) {
    const file = fs.readFileSync(_file, 'UTF-16LE').toString("ascii");
    let _data = file.split(/\n/).map(line => line.replace(/\r/, ""));
    // remove header
    _data = _data.slice(2);

    let reg = {};
    let _key = "";
    let _entry = "";
    let _value = "";
    let _pending_value = false;
    let _type = "";

    for (let cursor in _data) {

        let line = _data[cursor];
        
        // check if the line is a key
        if (line.match(/^\[.*\]$/)) {
            _key = line.replace(/\[|\]/g, "");
            reg[_key] = {};
        }
        
        // check if the line is a value
        else if (line.match(/^"(.*)"=(.*)$/)) {
            //  get the groups of the line
            let groups = line.match(/^"(.+)"=(.*)$/);
            _entry = groups[1];
            // replace only the quotes at the beginning and end of the value
            _value = groups[2];
    
            // to device the type check for a colon or a quote
            if(_value.match(/.*:.*/)) {
                let groups = _value.match(/(.+):(.*)/);
                _type = groups[1];
                _value = groups[2];
            } else if(_value.match(/^".*"$/)) {
                _type = "string";
                _value = _value.replace(/^"|"$/g, "");
            } else {
                throw new Error("Unknown type for " + _value + " in " + _key);
            }
            
            // check if the value is going to be continued
            if (_value.match(/\\$/)) {
                _value = _value.replace(/\\$/, "");
                _pending_value = true;
            }
    
            reg[_key][_entry] = {
                type: _type,
                value: _value
            }; 
    
        }
        // check if the line is a continuation of the value
        else if(_pending_value){
            //remove the duble space at the beginning of the line
            line = line.replace(/^\s+/, "");
            _value = line;
            // check if the value is going to be continued
            if (_value.match(/\\$/)) {
                _pending_value = true;
            } else {
                _value = "";
                _pending_value = false;
            }
            
            _value = _value.replace(/\\$/, "");
            reg[_key][_entry].value += _value;
    
        }
    }
    return reg;
}

export default {
    parseRegFile
};