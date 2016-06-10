var juggler = require('loopback-datasource-juggler');
var Registry = require('independent-juggler');
var registry = new Registry(juggler, { dir: __dirname });

var Connector = require('../..');
var credentials = require('../credentials.local.json');

registry.setupDataSource('auth0', {
    connector: Connector,
    connection: credentials.connection,
    domain: credentials.domain,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    user_metadata: {},  // optional overrides
    app_metadata: {},   // optional overrides
    mapping: {          // from Loopback to Auth0
        'favoriteColor': 'user_metadata.favoriteColor',
        'demoUser': 'app_metadata.demoUser'
    },
    attributes: { // enforced data attributes
        'demoUser': true
    },
    defaults: { // default data attributes
        favoriteColor: 'red'
    },
    queryScope: {
        where: { demoUser: true }
    },
    scopes: {} // Auth0 Token/Api scopes
});

module.exports = registry;
