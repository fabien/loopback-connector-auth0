var should = require('should');
var registry = require('./init');
var path = require('path');
var _ = require('lodash');

describe('Connector', function() {
    
    var EMAIL = 'info@fabien.be';
    var PASSWORD = '0D07322E-B2D3-4BCC-8577-07ad03fb332d';
    
    var Customer;
    var connector;
    var ids = {};
    
    before(function(next) {
        registry.connect(function(err, models) {
            Customer = models.Customer;
            connector = Customer.dataSource.connector;
            next();
        });
    });
    
    after(function(next) {
        registry.disconnect(next);
    });
    
    it('should create a query', function() {
        var baseQuery = '(app_metadata.demoUser:true AND identities.connection:"Username-Password-Authentication")';
        connector.buildQuery('Customer').should.eql({
            q: baseQuery, search_engine: 'v2'
        });
        connector.buildQuery('Customer', { limit: 5, offset: 1 }).should.eql({
            q: baseQuery, search_engine: 'v2',
            per_page: 5
        });
        connector.buildQuery('Customer', { limit: 5, offset: 2 }).should.eql({
            q: baseQuery, search_engine: 'v2',
            per_page: 5,
            page: 1
        });
        connector.buildQuery('Customer', { fields: ['id', 'favoriteColor', 'demoUser'] }).should.eql({
            q: baseQuery, search_engine: 'v2',
            fields: 'user_id,user_metadata.favoriteColor,app_metadata.demoUser'
        });
        connector.buildQuery('Customer', { where: { email: EMAIL } }).should.eql({
            q: 'email:"info@fabien.be" AND (app_metadata.demoUser:true AND identities.connection:"Username-Password-Authentication")',
            search_engine: 'v2'
        });
    });
    
    it('should create a lucene query', function() {
        var baseQuery = '(app_metadata.demoUser:true AND identities.connection:"Username-Password-Authentication")';
        connector.buildWhere('Customer').should.eql(baseQuery);
        connector.buildWhere('Customer', {
            email: 'info@fabien.be', favoriteColor: 'purple'
        }).should.eql('email:"info@fabien.be" AND user_metadata.favoriteColor:"purple" AND ' + baseQuery);
        connector.buildWhere('Customer', {
            email: { inq: ['info@fabien.be', 'info@foo.bar'] }
        }).should.eql('(email:"info@fabien.be" OR email:"info@foo.bar") AND ' + baseQuery);
        connector.buildWhere('Customer', {
            email: { nin: ['info@fabien.be', 'info@foo.bar'] }
        }).should.eql('-(email:"info@fabien.be" OR email:"info@foo.bar") AND ' + baseQuery);
        connector.buildWhere('Customer', {
            email: { like: ['info@*'] }
        }).should.eql('email:"info@*" AND ' + baseQuery);
        connector.buildWhere('Customer', {
            id: 'info@fabien.be' // aliased id when it contains @ - as email
        }).should.eql('email:"info@fabien.be" AND ' + baseQuery);
        connector.buildWhere('Customer', {
            or: [
                { email: 'info@fabien.be' },
                { favoriteColor: 'red', testing: false }
            ]
        }).should.eql('(email:"info@fabien.be" OR (user_metadata.favoriteColor:"red" AND app_metadata.testing:false)) AND ' + baseQuery);
    });
    
    it('should serialize user data using mapping, defaults and attributes', function() {
        connector.serializeData('Customer', {
            emailVerified: true,
            demoUser: false, // cannot be overridden
            testing: false   // cannot be overridden
        }).should.eql({
            user_metadata: { favoriteColor: 'red' },
            app_metadata: { demoUser: true, testing: true },
            email_verified: true
        });
        connector.serializeData('Customer', {
            favoriteColor: 'yellow'
        }).should.eql({
            user_metadata: { favoriteColor: 'yellow' },
            app_metadata: { demoUser: true, testing: true },
        });
    });
    
    it('should create a new user', function(next) {
        Customer.create({
            email: EMAIL,
            password: PASSWORD,
            emailVerified: true,
            favoriteColor: 'orange'
        }, function(err, user) {
            if (err) return next(err);
            user.id.should.be.a.string;
            ids.user = user.id;
            setTimeout(next, 1000);
        });
    });
    
    it('should find a user by id', function(next) {
        Customer.findById(ids.user, function(err, user) {
            user.id.should.equal(ids.user);
            user.email.should.equal(EMAIL);
            user.emailVerified.should.be.true;
            user.favoriteColor.should.equal('orange');
            user.demoUser.should.be.true;
            next();
        });
    });
    
    it('should find a user by email', function(next) {
        Customer.findById('info@fabien.be', function(err, user) {
            user.id.should.equal(ids.user);
            user.email.should.equal(EMAIL);
            next();
        });
    });
    
    it('should find multiple users by id', function(next) {
        Customer.findByIds([ids.user, 'xxx'], function(err, users) {
            users.should.have.length(1);
            users[0].id.should.equal(ids.user);
            users[0].email.should.equal(EMAIL);
            next();
        });
    });
    
    it('should find all users', function(next) {
        Customer.find({
            limit: 5,
            order: 'id DESC',
            fields: ['id', 'email']
        }, function(err, users) {
            if (err) return next(err);
            users.should.be.an.array;
            users.should.not.be.empty;
            users[0].should.be.instanceof(Customer);
            users[0].should.have.property('id');
            users[0].should.have.property('email');
            users[0].should.not.have.property('nickname');
            next();
        });
    });
    
    it('should find users - filtered (1)', function(next) {
        Customer.find({
            where: { email: EMAIL }
        }, function(err, users) {
            if (err) return next(err);
            users.should.be.an.array;
            users.should.have.length(1);
            users[0].should.be.instanceof(Customer);
            users[0].should.have.property('id');
            users[0].email.should.equal(EMAIL);
            users[0].createdAt.should.be.a.date;
            users[0].updatedAt.should.be.a.date;
            next();
        });
    });
    
    it('should find users - filtered (2)', function(next) {
        Customer.find({
            where: { favoriteColor: 'orange' }
        }, function(err, users) {
            if (err) return next(err);
            users.should.be.an.array;
            users.should.have.length(1);
            users[0].should.be.instanceof(Customer);
            users[0].id.should.equal(ids.user);
            users[0].email.should.equal(EMAIL);
            users[0].emailVerified.should.be.true;
            users[0].favoriteColor.should.equal('orange');
            _.any(users, { favoriteColor: 'orange' }).should.be.true;
            next();
        });
    });
    
    it('should find users - filtered (3)', function(next) {
        Customer.find({
            where: { favoriteColor: { neq: 'orange' } }
        }, function(err, users) {
            if (err) return next(err);
            users.should.be.an.array;
            users.should.not.be.empty;
            _.any(users, { favoriteColor: 'orange' }).should.be.false;
            next();
        });
    });
    
    it('should find users - filtered (4)', function(next) {
        Customer.find({
            where: { favoriteColor: 'red' }
        }, function(err, users) {
            if (err) return next(err);
            users.should.be.an.array;
            users.should.have.length(0);
            next();
        });
    });
    
    it('should find users - filtered (5)', function(next) {
        Customer.find({
            where: { email: 'fred@flintstone.com' }
        }, function(err, users) {
            if (err) return next(err);
            users.should.be.an.array;
            users.should.be.empty;
            next();
        });
    });
    
    it('should find users - filtered (6)', function(next) {
        Customer.find({
            where: { email: EMAIL, favoriteColor: 'orange' }
        }, function(err, users) {
            if (err) return next(err);
            users.should.be.an.array;
            users.should.have.length(1);
            users[0].id.should.equal(ids.user);
            users[0].email.should.equal(EMAIL);
            next();
        });
    });
    
    it('should find users - filtered (7)', function(next) {
        Customer.find({
            where: { email: EMAIL, favoriteColor: 'red' }
        }, function(err, users) {
            if (err) return next(err);
            users.should.be.an.array;
            users.should.be.empty;
            next();
        });
    });
    
    it('should find users - filtered (8)', function(next) {
        Customer.find({
            where: { email: { like: 'info@*' } }
        }, function(err, users) {
            if (err) return next(err);
            users.should.be.an.array;
            users.should.not.be.empty;
            _.pluck(users, 'id').should.containEql(ids.user);
            next();
        });
    });
    
    it('should find users - filtered (9)', function(next) {
        Customer.find({
            where: { email: { like: 'hello@*' } }
        }, function(err, users) {
            if (err) return next(err);
            users.should.be.an.array;
            users.should.be.empty;
            next();
        });
    });
    
    it('should find users - filtered (10)', function(next) {
        var luceneQuery = 'email:"info@fabien.be" AND user_metadata.favoriteColor:"orange"';
        Customer.find({
            where: { $where: luceneQuery }
        }, function(err, users) {
            if (err) return next(err);
            users.should.be.an.array;
            users.should.have.length(1);
            users[0].id.should.equal(ids.user);
            users[0].email.should.equal(EMAIL);
            next();
        });
    });
    
    it('should check if a user exists (1)', function(next) {
        Customer.exists(ids.user, function(err, exists) {
            exists.should.be.true;
            next();
        });
    });
    
    it('should check if a user exists (2)', function(next) {
        Customer.exists('xxx', function(err, exists) {
            exists.should.be.false;
            next();
        });
    });
    
    it('should count users', function(next) {
        Customer.count(function(err, count) {
            count.should.be.above(0);
            next();
        });
    });
    
    it('should count users - filtered (1)', function(next) {
        Customer.count({
            where: { email: EMAIL }
        }, function(err, count) {
            count.should.be.above(0);
            next();
        });
    });
    
    it('should count users - filtered (2)', function(next) {
        Customer.count({
            where: { email: 'fred@flintstone.com' }
        }, function(err, count) {
            count.should.equal(0);
            next();
        });
    });
    
    it('should delete users', function(next) {
        Customer.remove({ id: { inq: _.values(ids) } }, function(err, result) {
            if (err) return next(err);
            result.should.eql({ count: 1 });
            next();
        });
    });
    
    it('should have deleted user', function(next) {
        Customer.exists(ids.user, function(err, exists) {
            exists.should.be.false;
            next();
        });
    });
    
});