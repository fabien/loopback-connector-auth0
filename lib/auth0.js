var assert = require('assert');
var util = require('util');
var _ = require('lodash');
var async = require('async');
var ManagementClient = require('auth0').ManagementClient;

var mergeQuery = require('./utils').mergeQuery;
var buildQuery = require('./utils').buildQuery;
var normalizeQuery = require('./utils').normalizeQuery;
var formatKeys = require('./utils').formatKeys;
var extractObject = require('./utils').extractObject;
var traverseObject = require('./utils').traverseObject;
var memoize = require('./utils').memoize;

// See: https://auth0.com/docs/user-profile/normalized

var baseAttributes = [
    'connection', 'client_id',
    'username', 'password', 'blocked',
    'email', 'email_verified', 'client_id',
    'phone_number', 'phone_verified',
    'verify_email', 'verify_phone_number', 'verify_password',
    'user_metadata', 'app_metadata'
];

var serializeMapping = { // from Auth0 to Loopback
    'id': 'user_id',
    'username': 'username',
    'name': 'name',
    'nickname': 'nickname',
    'picture': 'picture',
    'password': 'password',
    'verifyPassword': 'verify_password',
    'email': 'email',
    'emailVerified': 'email_verified',
    'verifyEmail': 'verify_email',
    'phoneNumber': 'phone_number',
    'phoneVerified': 'phone_verified',
    'verifyPhoneNumber': 'verify_phone_number',
    'givenName': 'given_name',
    'familyName': 'family_name',
    'identities': 'identities',
    'createdAt': 'created_at',
    'updatedAt': 'updated_at',
    'clientId': 'client_id',
    'lastIp': 'last_ip',
    'lastLogin': 'last_login',
    'loginsCount': 'logins_count'
};

var formattedQueryKeys = [
    '$exists', '_exists_', '$missing', '_missing_'
];

var TOKEN_SCOPES = {
    users: ['create', 'read', 'update', 'delete'],
    users_app_metadata: ['create', 'read', 'update', 'delete']
};

var TOKEN_EXPIRATION_IN_SECONDS = 3600;

var Connector = require('loopback-connector').Connector;

module.exports = Auth0;

function Auth0(settings) {
    assert(typeof settings === 'object', 'cannot initialize Auth0 connector without a settings object');
    assert(typeof settings.domain === 'string', 'cannot initialize Auth0 connector without a domain');
    assert(typeof settings.clientId === 'string', 'cannot initialize Auth0 connector without a clientId');
    assert(typeof settings.clientSecret === 'string', 'cannot initialize Auth0 connector without a clientSecret');
    assert(typeof settings.connection === 'string', 'cannot initialize Auth0 connector without a connection');
    
    Connector.call(this, 'auth0', settings);
    
    this.createToken = require('auth0-api-tokens')(_.pick(settings, 'clientId', 'clientSecret'));
    
    this.serializeMapping = _.extend({}, settings.serializeMapping || serializeMapping, settings.mapping); // from Loopback to Auth0
    this.normalizeMapping = _.extend({}, settings.normalizeMapping, _.invert(this.serializeMapping)); // from Auth0 to Loopback
};

util.inherits(Auth0, Connector);

Auth0.initialize = function(dataSource, callback) {
    var connector = new Auth0(dataSource.settings);
    dataSource.connector = connector; // Attach connector to dataSource
    connector.dataSource = dataSource; // Hold a reference to dataSource
    process.nextTick(callback);
};

Auth0.prototype.define = function(modelDefinition) {
    modelDefinition.properties = modelDefinition.properties || {};
    modelDefinition.properties['id'] = { type: String, id: true };
    Connector.prototype.define.call(this, modelDefinition);
};

Auth0.prototype.ensureClient = memoize(function(model, scopes) {
    return new ManagementClient({
        domain: this.settings.domain,
        token: this.getToken(model, scopes)
    });
}, (TOKEN_EXPIRATION_IN_SECONDS - 5) * 1000);

Auth0.prototype.getModelSettings = function(model) {
    var modelClass = this._models[model];
    if (modelClass && modelClass.settings && _.isObject(modelClass.settings.auth0)) {
        return _.extend({}, modelClass.settings.auth0);
    }
    return {};
};

Auth0.prototype.getToken = function(model, scopes) {
    var modelSettings = this.getModelSettings(model);
    scopes = _.extend({}, TOKEN_SCOPES, this.settings.scopes, modelSettings.scopes, scopes);
    return this.createToken({
        scopes: scopes,
        lifetimeInSeconds: TOKEN_EXPIRATION_IN_SECONDS
    });
};

Auth0.prototype.getClient = function(model, options) {
    options = options || {};
    return this.ensureClient(model, options.scopes);
};

Auth0.prototype.getConnection = function(model) {
    var modelSettings = this.getModelSettings(model);
    return modelSettings.connection || this.settings.connection;
};

Auth0.prototype.create = function (model, data, options, callback) {
    createInstance.call(this, model, data, options, callback);
};

function createInstance(model, data, options, callback) {
    if (_.isFunction(options)) callback = options, options = {};
    options = _.extend({}, options);
    
    var modelSettings = this.getModelSettings(model);
    var client = this.getClient(model, options);
    
    data = this.serializeData(model, data || {}, options);
    data.connection = this.getConnection(model);
    
    client.users.create(data).then(function(user) {
        callback(null, user ? user.user_id : null, { isNewInstance: true });
    }, callback);
};

function updateInstance(model, id, data, options, callback) {
    if (!id) {
        var err = new Error('You must provide an id when updating attributes!');
        if (!callback) throw err;
        return callback(err);
    }
    
    data = this.serializeData(model, data, options);
    data.client_id = this.settings.clientId;
    data.connection = this.getConnection(model);
    
    var client = this.getClient(model, options);
    var normalizeData = this.normalizeData.bind(this, model);
    
    client.users.update({ id: id }, data).then(function(data) {
        callback(null, normalizeData(data), { isNewInstance: false });
    }, callback);
};

function updateAll(model, where, data, options, callback) {
    var self = this;
    this.all(model, { where: where }, options, function(err, users) {
        if (err) return callback(err);
        async.reduce(users, 0, function(memo, instance, next) {
            var updatedData = _.extend({}, instance, data);
            updateInstance.call(self, model, instance.id, updatedData, options, function(err, updated) {
                next(err, err ? memo : memo + 1);
            });
        }, function(err, count) {
            callback(err, { count: count });
        });
    });
};

Auth0.prototype.update = Auth0.prototype.updateAll = updateAll;

Auth0.prototype.save = function save(model, data, options, callback) {
    var id = this.getIdValue(model, data);
    if (_.isEmpty(id)) {
        createInstance.call(this, model, data, options, callback);
    } else {
        this.updateAttributes(model, id, data, options, callback);
    }
};

Auth0.prototype.updateAttributes = function updateAttributes(model, id, data, options, callback) {
    options = _.extend({ serializeDefaults: false }, options);
    var normalizeData = this.normalizeData.bind(this, model);
    this.fetch(model, id, options, function(err, instanceData) {
        if (!instanceData) err = new Error('Could not update attributes. Object with id ' + id + ' does not exist!');
        if (err) return callback(err);
        options.instanceData = instanceData;
        data = _.extend({}, normalizeData(instanceData), data);
        updateInstance.call(this, model, id, data, options, callback);
    }.bind(this));
};

Auth0.prototype.fetch = function fetch(model, id, options, callback) {
    if (_.isFunction(options)) callback = options, options = {};
    var client = this.getClient(model, options);
    var query = this.buildQuery(model, { where: { id: id } });
    var normalizeData = this.normalizeData.bind(this, model);
    client.users.getAll(query).then(function(items) {
        callback(null, items && items.length ? items[0] : null);
    }, callback);
};

Auth0.prototype.find = function find(model, id, options, callback) {
    var normalizeData = this.normalizeData.bind(this, model);
    this.fetch(model, id, options, function(err, user) {
        callback(err, user ? normalizeData(user) : null);
    });
};

Auth0.prototype.all = function all(model, filter, options, callback) {
    var client = this.getClient(model, options);
    var normalizeData = this.normalizeData.bind(this, model);
    client.users.getAll(this.buildQuery(model, filter)).then(function(users) {
        callback(null, _.map(users, normalizeData));
    }, callback);
};

Auth0.prototype.exists = function exists(model, id, options, callback) {
    this.count(model, { id: id }, options, function(err, count) {
        callback(err, err ? false : count > 0);
    });
};

Auth0.prototype.count = function count(model, where, options, callback) {
    var client = this.getClient(model, options);
    var query = this.buildQuery(model, { where: where || {} });
    query.fields = 'user_id';
    query.per_page = 1;
    query.include_totals = true;
    client.users.getAll(query).then(function(result) {
        callback(null, result.total || 0);
    }, callback);
};

Auth0.prototype.destroy = function destroy(model, id, options, callback) {
    var client = this.getClient(model, options);
    client.users.delete({ id: id }).then(function(result) {
        callback(null, { count: 1 });
    }, callback);
};

Auth0.prototype.destroyAll = function destroyAll(model, where, options, callback) {
    if (_.isObject(where) && _.isString(where.id)) {
        this.destroy(model, where.id, options, callback);
    } else {
        var self = this;
        this.all(model, { where: where, fields: ['id'] }, options, function(err, users) {
            if (err) return callback(err);
            async.reduce(users, 0, function(memo, user, next) {
                self.destroy(model, user.id, options, function(err, result) {
                    next(err, result ? memo + result.count : memo);
                });
            }, function(err, count) {
                callback(err, { count: count });
            });
        });
    }
};

// Custom methods

Auth0.prototype.link = function(model, id, data, options, callback) {
    if (_.isFunction(options)) callback = options, options = {};
    var client = this.getClient(model, options);
    client.users.link(id, data, callback);
};

Auth0.prototype.unlink = function(model, id, data, options, callback) {
    if (_.isFunction(options)) callback = options, options = {};
    data = _.extend({ id: id }, data);
    var client = this.getClient(model, options);
    client.users.unlink(data, callback);
};

// Data handling

Auth0.prototype.normalizeFields = function(model, fields) {
    return _.map(fields, this.normalizeField.bind(this, model));
};

Auth0.prototype.normalizeField = function(model, field) {
    var mapping = this.getSerializeMapping(model);
    return mapping[field] || field;
};

Auth0.prototype.buildWhere = function(model, where) {
    var where = _.extend({}, where);
    var normalizeField = this.normalizeField.bind(this, model);
    var query = {};
    
    if (!_.isEmpty(where)) {
        where = normalizeQuery(where, function(key, val) { // first
            if (_.include(formattedQueryKeys, key)) {
                return normalizeField(val);
            }
            return val;
        });
        where = formatKeys(where, normalizeField);
        query = buildQuery(where);
    }
    
    return query;
};

Auth0.prototype.buildQuery = function(model, filter) {
    filter = _.extend({}, filter);
    var query = {};
    
    var normalizeFields = this.normalizeFields.bind(this, model);
    
    var modelSettings = this.getModelSettings(model);
    var connection = this.getConnection(model);
    
    filter.where = _.extend({}, filter.where);
    mergeQuery(filter, this.settings.queryScope || {});
    mergeQuery(filter, modelSettings.queryScope || {});
    
    if (this.settings.connectionQueryScope !== false &&
        modelSettings.connectionQueryScope !== false) {
        mergeQuery(filter, { where: { connection: connection } });
    }
    
    var q = this.buildWhere(model, filter.where);
    if (!_.isEmpty(q)) query.q = q;
    if (!_.isEmpty(q)) query.search_engine = 'v3';
    
    if (_.isNumber(filter.limit)) {
        query.per_page = filter.limit;
    }
    
    if (_.isNumber(filter.offset) && filter.offset > 1) {
        query.page = filter.offset - 1;
    } else if (_.isNumber(filter.skip) && filter.skip > 1) {
        query.page = filter.skip - 1;
    }
    
    if (_.isArray(filter.fields) && !_.isEmpty(filter.fields)) {
        query.fields = normalizeFields(filter.fields).join(',');
    }
    
    if (filter.order) {
        var sort = this.buildOrder(model, filter.order);
        if (!_.isEmpty(sort)) query.sort = sort;
    }
    
    if (_.isBoolean(filter.totals)) query.include_totals = true;
    
    return query;
};

Auth0.prototype.buildOrder = function(model, order) {
    var normalizeField = this.normalizeField.bind(this);
    var valid = ['email', 'connection', 'user_id', 'created_at', 'last_login'];
    var sort = [];
    var keys = order;
    if (typeof keys === 'string') keys = keys.split(',');
    _.each(keys, function(key) {
        var m = key.match(/\s+(A|DE)SC$/);
        key = key.replace(/\s+(A|DE)SC$/, '').trim();
        key = normalizeField(key);
        if (!_.include(valid, key)) return;
        if (m && String(m[1]).toUpperCase() === 'DE') {
            sort.push(key + ':-1');
        } else {
            sort.push(key + ':1');
        }
    });
    return _.first(sort);
};

Auth0.prototype.getNormalizeMapping = function(model) {
    var modelSettings = this.getModelSettings(model);
    var customMapping = modelSettings.normalizeMapping || _.invert(this.getSerializeMapping(model));
    return _.extend({}, this.normalizeMapping, customMapping);
};

Auth0.prototype.getSerializeMapping = function(model) {
    var modelSettings = this.getModelSettings(model);
    var customMapping = modelSettings.serializeMapping || modelSettings.mapping;
    return _.extend({}, this.serializeMapping, customMapping);
};

Auth0.prototype.normalizeData = function(model, data) {
    var dates = ['createdAt', 'updatedAt', 'lastLogin'];
    var mapping = this.getNormalizeMapping(model);
    var data = extractObject(data, mapping);
    return traverseObject(data, function(node, value) {
        if (_.include(dates, node.key)) node.update(new Date(value));
    });
};

Auth0.prototype.serializeData = function(model, data, options) {
    var modelSettings = this.getModelSettings(model);
    var mapping = this.getSerializeMapping(model);
    data = _.extend({}, data);
    options = _.extend({}, options);
    
    if (options.serializeDefaults !== false) {
        setDefaults(data, this.settings.defaults, options);
        setDefaults(data, modelSettings.defaults, options);
    }
    
    setAttributes(data, this.settings.attributes, options);
    setAttributes(data, modelSettings.attributes, options);
    
    data = extractObject(data, mapping);
    
    var instanceData = options.instanceData || {};
    var app_metadata = instanceData.app_metadata || {};
    var user_metadata = instanceData.user_metadata || {};
    
    data.app_metadata = _.extend({}, app_metadata, data.app_metadata,
        modelSettings.app_metadata, options.app_metadata);
    data.user_metadata = _.extend({}, user_metadata, data.user_metadata,
        modelSettings.user_metadata, options.user_metadata);
    
    data = _.pick(data, baseAttributes);
    
    if (_.isArray(options.omit)) data = _.omit(data, options.omit);
    if (_.isArray(options.pick)) data = _.pick(data, options.pick);
    
    return data;
};

function setDefaults(data, source, options) {
    if (_.isObject(source)) {
        _.defaults(data, source);
    } else if (_.isFunction(source)) {
        _.defaults(data, source(model, data, options));
    }
};

function setAttributes(data, source, options) {
    if (_.isObject(source)) {
        _.merge(data, source);
    } else if (_.isFunction(source)) {
        _.merge(data, source(model, data, options));
    }
};
