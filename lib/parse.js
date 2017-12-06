'use strict';

var utils = require('./utils');

var has = Object.prototype.hasOwnProperty;

var defaults = {
    allowDots: false,
    allowPrototypes: false,
    arrayLimit: 20,
    decoder: utils.decode,
    delimiter: '&',
    depth: 5,
    parameterLimit: 1000,
    plainObjects: false,
    strictNullHandling: false
};

var parseEntry = function parseEntry(chain, val, options) {
    var leaf = val;

    for (var i = chain.length - 1; i >= 0; --i) {
        var obj;
        var root = chain[i];

        if (root === '[]') {
            obj = [];
            obj = obj.concat(leaf);
        } else {
            obj = options.plainObjects ? Object.create(null) : {};
            var cleanRoot = root.charAt(0) === '[' && root.charAt(root.length - 1) === ']' ? root.slice(1, -1) : root;
            var index = parseInt(cleanRoot, 10);
            if (
                !isNaN(index)
                && root !== cleanRoot
                && String(index) === cleanRoot
                && index >= 0
                && (options.parseArrays && index <= options.arrayLimit)
            ) {
                obj = [];
                obj[index] = leaf;
            } else {
                obj[cleanRoot] = leaf;
            }
        }

        leaf = obj;
    }

    return leaf;
};

var parseKey = function parseKey(givenKey, options) {
    if (!givenKey) {
        return;
    }

    // Transform dot notation to bracket notation
    var key = options.allowDots ? givenKey.replace(/\.([^.[]+)/g, '[$1]') : givenKey;

    // The regex chunks

    var brackets = /(\[[^[\]]*])/;
    var child = /(\[[^[\]]*])/g;

    // Get the parent

    var segment = brackets.exec(key);
    var parent = segment ? key.slice(0, segment.index) : key;

    // Stash the parent if it exists

    var keys = [];
    if (parent) {
        // If we aren't using plain objects, optionally prefix keys
        // that would overwrite object prototype properties
        if (!options.plainObjects && has.call(Object.prototype, parent)) {
            if (!options.allowPrototypes) {
                return;
            }
        }

        keys.push(parent);
    }

    // Loop through children appending to the array until we hit depth

    var i = 0;
    while ((segment = child.exec(key)) !== null && i < options.depth) {
        i += 1;
        if (!options.plainObjects && has.call(Object.prototype, segment[1].slice(1, -1))) {
            if (!options.allowPrototypes) {
                return;
            }
        }
        keys.push(segment[1]);
    }

    // If there's a remainder, just add whatever is left

    if (segment) {
        keys.push('[' + key.slice(segment.index) + ']');
    }

    return keys;
};

var numericKeyRegex = /\[([0-9]+)\]/;
var getNumericKey = function getNumericKey(key) {
    var result = numericKeyRegex.exec(key);
    return result && (result.length > 0) && parseInt(result[1], 10);
};

// Normalize BY REFERENCE, roughly changing the parsed versions of
// 'a[]=x&a[]=y' into 'a[0]=x&a[1]=y'
var normalizeKeys = function normalizeKeys(parsedKeys) {
    var i, j, indexKey, number;
    var nextIndex = {};
    for (i = 0; i < parsedKeys.length; ++i) {
        if (parsedKeys[i] && parsedKeys[i].length > 0) {
            for (j = 1; j < parsedKeys[i].length; ++j) {
                indexKey = parsedKeys[i].slice(0, j).join('');
                if (parsedKeys[i][j] === '[]') {
                    nextIndex[indexKey] = (typeof nextIndex[indexKey] === 'number' ? nextIndex[indexKey] : -1) + 1;
                    parsedKeys[i][j] = '[' + nextIndex[indexKey] + ']';
                } else {
                    number = getNumericKey(parsedKeys[i][j]);
                    /* eslint-disable max-depth */
                    if (number) {
                        nextIndex[indexKey] = Math.max(nextIndex[indexKey] || 0, number);
                    }
                    /* eslint-enable max-depth */
                }
            }
        }
    }
};

var parseString = function parseString(str, options) {
    var keys = [];
    var values = [];
    var cleanStr = options.ignoreQueryPrefix ? str.replace(/^\?/, '') : str;
    var limit = options.parameterLimit === Infinity ? undefined : options.parameterLimit;
    var parts = cleanStr.split(options.delimiter, limit);

    for (var i = 0; i < parts.length; ++i) {
        var part = parts[i];

        var bracketEqualsPos = part.indexOf(']=');
        var pos = bracketEqualsPos === -1 ? part.indexOf('=') : bracketEqualsPos + 1;

        var key, val;
        if (pos === -1) {
            key = options.decoder(part, defaults.decoder);
            val = options.strictNullHandling ? null : '';
        } else {
            key = options.decoder(part.slice(0, pos), defaults.decoder);
            val = options.decoder(part.slice(pos + 1), defaults.decoder);
        }
        values.push(val);
        keys.push(key);
    }

    var parsedKeys = [];
    if (keys && keys.length) {
        for (i = 0; i < keys.length; ++i) {
            parsedKeys[i] = parseKey(keys[i], options);
        }
    }

    return { keys: parsedKeys, values: values };
};

var isParsableObject = function isParsableObject(obj) {
    return (
        obj && (typeof obj === 'object')
        && (Object.prototype.toString.call(obj) === '[object Object]')
    );
};

var parseObject = function parseObject(obj, options, path, parsed) {
    var keys = [];
    var values = [];
    var objKeys = Object.keys(obj);
    for (var i = 0; i < objKeys.length; i++) {
        var key = objKeys[i];
        var val = obj[key];
        var parsedKey = parseKey(key, options);
        if (
            options.parseObjectsRecursively
            && isParsableObject(val)
            && (parsed.indexOf(val) === -1)
        ) {
            parsed.push(val);
            var kv = parseObject(val, options, path.concat(parsedKey), parsed);
            Array.prototype.push.apply(keys, kv.keys);
            Array.prototype.push.apply(values, kv.values);
        } else {
            keys.push(path.concat(parsedKey));
            values.push(val);
        }
    }
    return { keys: keys, values: values };
};

module.exports = function (str, opts) {
    var options = opts ? utils.assign({}, opts) : {};

    if (options.decoder !== null && options.decoder !== undefined && typeof options.decoder !== 'function') {
        throw new TypeError('Decoder has to be a function.');
    }

    options.ignoreQueryPrefix = options.ignoreQueryPrefix === true;
    options.delimiter = typeof options.delimiter === 'string' || utils.isRegExp(options.delimiter) ? options.delimiter : defaults.delimiter;
    options.depth = typeof options.depth === 'number' ? options.depth : defaults.depth;
    options.arrayLimit = typeof options.arrayLimit === 'number' ? options.arrayLimit : defaults.arrayLimit;
    options.parseArrays = options.parseArrays !== false;
    options.parseObjectsRecursively = options.parseObjectsRecursively === true;
    options.decoder = typeof options.decoder === 'function' ? options.decoder : defaults.decoder;
    options.allowDots = typeof options.allowDots === 'boolean' ? options.allowDots : defaults.allowDots;
    options.plainObjects = typeof options.plainObjects === 'boolean' ? options.plainObjects : defaults.plainObjects;
    options.allowPrototypes = typeof options.allowPrototypes === 'boolean' ? options.allowPrototypes : defaults.allowPrototypes;
    options.parameterLimit = typeof options.parameterLimit === 'number' ? options.parameterLimit : defaults.parameterLimit;
    options.strictNullHandling = typeof options.strictNullHandling === 'boolean' ? options.strictNullHandling : defaults.strictNullHandling;

    if (str === '' || str === null || typeof str === 'undefined') {
        return options.plainObjects ? Object.create(null) : {};
    }

    // Final return value
    var receiver = options.plainObjects ? Object.create(null) : {};

    // Parse the input into { keys, values }
    // Note that the keys are parsed into arrays of distinct elements, e.g. if
    // str = 'a[b][c]=d&e=f', then
    // kv = { keys: [['a','[b]','[c]'], ['e']], values: ['d', 'f'] }
    var kv;
    if (typeof str === 'string') {
        kv = parseString(str, options);
    } else if (isParsableObject(str)) {
        kv = parseObject(str, options, [], []);
    } else {
        return receiver;
    }

    // Merge entries into receiver
    var i;
    var keys = kv.keys;
    var values = kv.values;
    if (keys && keys.length) {
        normalizeKeys(keys);
        for (i = 0; i < keys.length; ++i) {
            if (typeof keys[i] !== 'undefined') {
                var newObj = parseEntry(keys[i], values[i], options);
                receiver = utils.merge(receiver, newObj, options);
            }
        }
    }

    return utils.compact(receiver);
};
