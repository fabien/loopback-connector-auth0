# loopback-connector-auth0

Loopback connector for Auth0 User Management.

Connector config example:

``` js
{
    "domain": "DOMAIN_NAME.auth0.com",
    "clientId": "CLIENT_ID",
    "clientSecret": "CLIENT_SECRET",
    "connection": "CONNECTION_NAME",  // all operations will be limited to this connection
    "user_metadata": {},              // optional overrides,
    "app_metadata": {},               // optional overrides
    "mapping": {                      // mapping attributes from Loopback to Auth0
        "favoriteColor": "user_metadata.favoriteColor",
        "group": "demo"
    },
    "attributes": {                   // enforced data attributes
        "group": "demo"
    },
    "defaults": {                     // default data attributes
        "favoriteColor": "red"
    },
    "connectionQueryScope": true,     // always apply connection query scope (default: true)
    "queryScope": {                   // default/enforced query scope (Loopback)
        "where": { "group": "demo" }
    },
    "scopes": {                       // API scopes (permissions)
        "users": ["create", "read", "update", "delete"],
        "users_app_metadata": ["create", "read", "update", "delete"]
    }
}
```

Note: create a file `test/credentials.local.json` with the following parameters:


``` json
{
    "domain": "DOMAIN_NAME.auth0.com",
    "clientId": "CLIENT_ID",
    "clientSecret": "CLIENT_SECRET",
    "connection": "CONNECTION_NAME"
}
```