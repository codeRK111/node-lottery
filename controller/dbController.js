var assert = require('assert');
var uuid = require('uuid');
var config = require('../config/config');

var async = require('async');
var lib = require('./lib');
var pg = require('pg');
var passwordHash = require('password-hash');
var speakeasy = require('speakeasy');
var m = require('multiline');

var databaseUrl = config.DATABASE_URL;

if (!databaseUrl)
    throw new Error('must set DATABASE_URL environment var');

console.log('DATABASE_URL: ', databaseUrl);


pg.types.setTypeParser(20, function(val) { // parse int8 as an integer
    return val === null ? null : parseInt(val);
});

// callback is called with (err, client, done)
function connect(callback) {
    return pg.connect(databaseUrl, callback);
}

function query(query, params, callback) {
    //third parameter is optional
    if (typeof params == 'function') {
        callback = params;
        params = [];
    }

    doIt();
    function doIt() {
        connect(function(err, client, done) {
            if (err) return callback(err);
            client.query(query, params, function(err, result) {
                done();
                if (err) {
                    if (err.code === '40P01') {
                        console.log('Warning: Retrying deadlocked transaction: ', query, params);
                        return doIt();
                    }
                    return callback(err);
                }

                callback(null, result);
            });
        });
    }
}

exports.query = query;

pg.on('error', function(err) {
    console.error('POSTGRES EMITTED AN ERROR', err);
});


// runner takes (client, callback)

// callback should be called with (err, data)
// client should not be used to commit, rollback or start a new transaction

// callback takes (err, data)

function getClient(runner, callback) {
    doIt();

    function doIt() {
        connect(function (err, client, done) {
            if (err) return callback(err);

            function rollback(err) {
                client.query('ROLLBACK', done);

                if (err.code === '40P01') {
                    console.log('Warning: Retrying deadlocked transaction..');
                    return doIt();
                }

                callback(err);
            }

            client.query('BEGIN', function (err) {
                if (err)
                    return rollback(err);

                runner(client, function (err, data) {
                    if (err)
                        return rollback(err);

                    client.query('COMMIT', function (err) {
                        if (err)
                            return rollback(err);

                        done();
                        callback(null, data);
                    });
                });
            });
        });
    }
}

//Returns a sessionId
exports.createUser = function(username, password, email, ipAddress, userAgent, callback) {
    assert(username && password);

    getClient(
        function(client, callback) {
            var hashedPassword = passwordHash.generate(password);

            client.query('SELECT COUNT(*) count FROM users WHERE lower(username) = lower($1)', [username],
                function(err, data) {
                    if (err) return callback(err);
                    assert(data.rows.length === 1);
                    if (data.rows[0].count > 0)
                        return callback('USERNAME_TAKEN');

                    client.query('INSERT INTO users(username, email, password) VALUES($1, $2, $3) RETURNING id',
                            [username, email, hashedPassword],
                            function(err, data) {
                                if (err)  {
                                    if (err.code === '23505')
                                        return callback('USERNAME_TAKEN');
                                    else
                                        return callback(err);
                                }

                                assert(data.rows.length === 1);
                                var user = data.rows[0];

                                createSession(client, user.id, ipAddress, userAgent, false, callback);
                            }
                        );

                    });
        }
    , callback);
};

exports.updateEmail = function(userId, email, callback) {
    assert(userId);

    query('UPDATE users SET email = $1 WHERE id = $2', [email, userId], function(err, res) {
        if(err) return callback(err);

        assert(res.rowCount === 1);
        callback(null);
    });

};

exports.changeUserPassword = function(userId, password, callback) {
    assert(userId && password && callback);
    var hashedPassword = passwordHash.generate(password);
    query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, userId], function(err, res) {
        if (err) return callback(err);
        assert(res.rowCount === 1);
        callback(null);
    });
};


// Possible errors:
//   NO_USER, WRONG_PASSWORD, INVALID_OTP
exports.validateUser = function(username, password, otp, callback) {
    assert(username && password);

    query('SELECT id, password, mfa_secret FROM users WHERE lower(username) = lower($1)', [username], function (err, data) {
        if (err) return callback(err);

        if (data.rows.length === 0)
            return callback('NO_USER');

        var user = data.rows[0];

        var verified = passwordHash.verify(password, user.password);
        if (!verified)
            return callback('WRONG_PASSWORD');

        if (user.mfa_secret) {
            if (!otp) return callback('INVALID_OTP'); // really, just needs one

            var expected = speakeasy.totp({ key: user.mfa_secret, encoding: 'base32' });

            if (otp !== expected)
                return callback('INVALID_OTP');
        }

        callback(null, user.id);
    });
};

/** Expire all the not expired sessions of an user by id **/
exports.expireSessionsByUserId = function(userId, callback) {
    assert(userId);

    query('UPDATE sessions SET expired = now() WHERE user_id = $1 AND expired > now()', [userId], callback);
};


function createSession(client, userId, ipAddress, userAgent, remember, callback) {
    var sessionId = uuid.v4();

    var expired = new Date();
    if (remember)
        expired.setFullYear(expired.getFullYear() + 10);
    else
        expired.setDate(expired.getDate() + 21);

    client.query('INSERT INTO sessions(id, user_id, ip_address, user_agent, expired) VALUES($1, $2, $3, $4, $5) RETURNING id',
        [sessionId, userId, ipAddress, userAgent, expired], function(err, res) {
        if (err) return callback(err);
        assert(res.rows.length === 1);

        var session = res.rows[0];
        assert(session.id);

        callback(null, session.id, expired);
    });
}

exports.createOneTimeToken = function(userId, ipAddress, userAgent, callback) {
    assert(userId);
    var id = uuid.v4();

    query('INSERT INTO sessions(id, user_id, ip_address, user_agent, ott) VALUES($1, $2, $3, $4, true) RETURNING id', [id, userId, ipAddress, userAgent], function(err, result) {
        if (err) return callback(err);
        assert(result.rows.length === 1);

        var ott = result.rows[0];

        callback(null, ott.id);
    });
};

exports.createSession = function(userId, ipAddress, userAgent, remember, callback) {
    assert(userId && callback);

    getClient(function(client, callback) {
        createSession(client, userId, ipAddress, userAgent, remember, callback);
    }, callback);

};


exports.createGame = function(callback,game_name,game_type) {

    query('INSERT INTO games(game_name, game_type) VALUES($1, $2) RETURNING id', [game_name,game_type], function(err, result) {
        if (err) return callback(err);
        assert(result.rows.length === 1);

        var game = result.rows[0];

        callback(null, game.id);
    });
};

exports.joinGame = function(userId, ipAddress, userAgent,game_id,callback) {

    query('INSERT INTO plays(game_id,user_id,ipaddress,useragent) VALUES($1, $2, $3, $4) RETURNING id', [game_name,game_type], function(err, result) {
        if (err) return callback(err);
        assert(result.rows.length === 1);

        var play = result.rows[0];

        callback(null, game.id);
    });
};

exports.getGameHistory = function(gameId,limit, callback){
    assert(typeof gameId === 'number');
    assert(typeof limit === 'number');
    var sql = "SELECT u.userid as playerid, u.username as playername, p.wonprice as pricewon, timeago FROM users u join plays p ON users.id = plays.user_id WHERE p.gameId = $1 ORDER BY p.gameId DESC LIMIT $2";
    query(sql, [gameId, limit], function(err, data) {
        if(err)
            return callback(err);
        callback(null, data.rows);
    });
};