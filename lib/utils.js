var _ = require('lodash');
var traverse = require('traverse');

function extractObject(obj, mapping, merge) {
    var mapped = {}; // from => to
    var mappedKeys = [];
    _.each(mapping || {}, function(to, from) {
        if (_.isNull(from) || _.isNull(to)) return; // skip
        var value = _.get(obj, from);
        if (!_.isUndefined(value)) {
            mappedKeys.push(from);
            _.set(mapped, to, value);
        }
    });
    if (merge) {
        var unmappedKeys = _.difference(_.keys(obj), mappedKeys);
        return _.extend(extractAttributes(obj, unmappedKeys), mapped);
    }
    return mapped;
};

function formatKeys(obj, callback, formatValue) {
    if (_.isString(callback)) callback = _[callback].bind(_);
    formatValue = _.isFunction(formatValue) ? formatValue : null;
    var cloned = _.cloneDeep(obj);
    traverse(cloned).forEach(function(val) {
        if (this.key && _.isString(this.key)) {
            this.delete();
            this.key = callback(this.key, val);
            this.update(formatValue ? formatValue(this.key, val) : val);
        }
    });
    return cloned;
};

function traverseObject(obj, callback) {
    if (_.isString(callback)) callback = _[callback].bind(_);
    var cloned = _.cloneDeep(obj);
    traverse(cloned).forEach(function(val) {
        callback(this, val);
    });
    return cloned;
};

function normalizeQuery(obj, formatValue) {
    return formatKeys(obj, function(key, val) {
        if (key === 'id' && String(val).indexOf('@') > 0) {
            key = 'email';
        } else if (key === 'id') {
            key = 'user_id';
        } else if (key === 'connection') {
            key = 'identities.connection';
        }
        return key;
    }, formatValue);
};

function buildSubQuery(key, value) {
    var sub = {};
    sub[key] = value;
    return sub;
};

function buildQuery(obj, parentKey) {
    var search = [];
    if (!_.isObject(obj) && parentKey) {
        return buildQuery(buildSubQuery(parentKey, obj));
    }
    if (!_.isObject(obj)) return search;
    var keys = Object.keys(obj);
    _.each(obj, function(value, key) {
        var q;
        switch (key) {
            case '$where': // Raw lucene query
                search.push(value);
                break;
            case '$search': // Cross-field search
                search.push(value);
                break;
            case '$exists':
            case '_exists_':
                search.push('_exists_:' + value);
                break;
            case '$missing':
            case '_missing_':
                search.push('_missing_:' + value);
                break;
            case 'and':
            case 'or':
                var logic = key === 'or' ? ' OR ' : ' AND ';
                if (_.isArray(value) && value.length === 1 && parentKey) {
                    search.push(buildQuery(value[0], key));
                } else if (_.isArray(value) && value.length > 0) {
                    var q = _.map(value, buildQuery).join(logic);
                    search.push('(' + q + ')');
                }
                break;
            case 'gt':
                search.push('{' + value + ' TO *]');
                break;
            case 'gte':
                search.push('[' + value + ' TO *]');
                break;
            case 'lt':
                search.push('[ * TO ' + value + '}');
                break;
            case 'lte':
                search.push('[ * TO ' + value + ']');
                break;
            case 'between':
                if (_.isArray(value)) {
                    search.push('[' + value[0] + ' TO ' + value[1] + ']');
                }
                break;
            case 'inq':
            case 'nin':
                var conditions = [].concat(value || []);
                if (parentKey && conditions.length > 0) {
                    conditions = _.map(conditions, quoteArgument);
                    q = parentKey + ':(' + conditions.join(' OR ') + ')';
                    search.push(key === 'nin' ? '-' + q : q);
                }
                break;
            case 'neq':
                q = buildQuery(value, parentKey);
                search.push(['-(' + q + ')']);
                break
            case 'near':
                break;
            case 'like':
            case 'nlike':
                if (parentKey) {
                    q = (key === 'nlike' ? '-' : '');
                    search.push(q + parentKey + ':' + quoteArgument(value));
                }
                break;
            default:
                if (_.isPlainObject(value)) {
                    search.push(buildQuery(value, key));
                } else if (_.isNull(value)) {
                    search.push('(' + key + ':"" OR ' + key + ':0 OR _missing_:' + key + ')');
                } else {
                    search.push(key + ':' + quoteArgument(value));
                }
        }
    });
    var query = search.join(' AND ');
    return search.length > 1 && parentKey ? '(' + query + ')' : query;
};

function quoteArgument(v) {
    if (_.isString(v)) return '"' + v + '"';
    return v;
};

/*!
 * Merge query parameters
 * @param {Object} base The base object to contain the merged results
 * @param {Object} update The object containing updates to be merged
 * @param {Object} spec Optionally specifies parameters to exclude (set to false)
 * @returns {*|Object} The base object
 * @private
 */
function mergeQuery(base, update, spec) {
    if (!update) return;
    spec = spec || {};
    base = base || {};
    
    if (update.where && Object.keys(update.where).length > 0) {
        if (base.where && Object.keys(base.where).length > 0) {
            base.where = {and: [base.where, update.where]};
        } else {
            base.where = update.where;
        }
    }
    
    // Merge inclusion
    if (spec.include !== false && update.include) {
        if (!base.include) {
            base.include = update.include;
        } else {
            if (spec.nestedInclude === true){
                //specify nestedInclude=true to force nesting of inclusions on scoped
                //queries. e.g. In physician.patients.getAsync({include: 'address'}),
                //inclusion should be on patient model, not on physician model.
                var saved = base.include;
                base.include = {};
                base.include[update.include] = saved;
            } else{
                //default behaviour of inclusion merge - merge inclusions at the same
                //level. - https://github.com/strongloop/loopback-datasource-juggler/pull/569#issuecomment-95310874
                base.include = mergeIncludes(base.include, update.include);
            }
        }
    }
    
    if (spec.collect !== false && update.collect) {
        base.collect = update.collect;
    }
    
    // Overwrite fields
    if (spec.fields !== false && update.fields !== undefined) {
        base.fields = update.fields;
    } else if (update.fields !== undefined) {
        base.fields = [].concat(base.fields).concat(update.fields);
    }
    
    // set order
    if ((!base.order || spec.order === false) && update.order) {
        base.order = update.order;
    }
    
    // overwrite pagination
    if (spec.limit !== false && update.limit !== undefined) {
        base.limit = update.limit;
    }
    
    var skip = spec.skip !== false && spec.offset !== false;
    
    if (skip && update.skip !== undefined) {
        base.skip = update.skip;
    }
    
    if (skip && update.offset !== undefined) {
        base.offset = update.offset;
    }
    
    return base;
};

function hashFn() {
    return hashify(_.toArray(arguments));
};

function hashify(obj) {
    function flatten(obj) {
        if (_.isObject(obj)) {
            var fnA = function(p) { return [p[0], flatten(p[1])]; };
            var fnB = function(p) { return p[0]; };
            return _.sortBy(_.map(_.pairs(obj), fnA), fnB);
        }
        return obj;
    }
    return JSON.stringify(flatten(obj));
};
    
function memoize(func, ttl, hasher) {
    var m;
    if (hasher == null) hasher = hashFn;
    if (ttl == null) ttl = 0;
    var m = function() {
        var cache = m.cache;
        var key = hasher.apply(this, arguments);
        var now = Date.now();
        _.each(cache, function(spec, k) { if (now > cache[k].expires) delete cache[k]; });
        if (key === 'NO_CACHE') {
            return func.apply(this, arguments);
        } else if (!_.has(cache, key)) {
            cache[key] = { value: func.apply(this, arguments), expires: now + ttl };
        }
        return cache[key].value;
    };
    m.cache = {};
    return m;
};

module.exports = {
    formatKeys: formatKeys,
    extractObject: extractObject,
    traverseObject: traverseObject,
    normalizeQuery: normalizeQuery,
    buildQuery: buildQuery,
    mergeQuery: mergeQuery,
    memoize: memoize
};
