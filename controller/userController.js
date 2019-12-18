var config = require('../config/config');
var database = require('./dbController');
var lib = require('./libController');
var assert = require('better-assert');
var async = require('async');
//Set Session and check the Environment of the Application
var sessionOptions = {
    httpOnly: true,
    secure : config.PRODUCTION
};

exports.register  = function(req, res, next) {
    var values = _.merge(req.body, { user: {} });
    //var recaptcha = lib.removeNullsAndTrim(req.body['g-recaptcha-response']);
    var username = lib.removeNullsAndTrim(values.user.name);
    var password = lib.removeNullsAndTrim(values.user.password);
    var password2 = lib.removeNullsAndTrim(values.user.confirm);
    var email = lib.removeNullsAndTrim(values.user.email);
    var ipAddress = req.ip;
    var userAgent = req.get('user-agent');

    var notValid = lib.isInvalidUsername(username);
    if (notValid) return res.render('register', { warning: 'username not valid because: ' + notValid, values: values.user });

    // stop new registrations of >16 char usernames
    if (username.length > 16)
        return res.render('register', { warning: 'Username is too long', values: values.user });

    notValid = lib.isInvalidPassword(password);
    if (notValid) {
        values.user.password = null;
        values.user.confirm = null;
        return res.render('register', { warning: 'password not valid because: ' + notValid, values: values.user });
    }

    if (email) {
        notValid = lib.isInvalidEmail(email);
        if (notValid) return res.render('register', { warning: 'email not valid because: ' + notValid, values: values.user });
    }

    // Ensure password and confirmation match
    if (password !== password2) {
        return res.render('register', {
          warning: 'password and confirmation did not match'
        });
    }

    database.createUser(username, password, email, ipAddress, userAgent, function(err, sessionId) {
        if (err) {
            if (err === 'USERNAME_TAKEN') {
                values.user.name = null;
                return res.render('register', { warning: 'User name taken...', values: values.user});
            }
            return next(new Error('Unable to register user: \n' + err));
        }
        res.cookie('id', sessionId, sessionOptions);
        return res.redirect('/play?m=new');
    });
};

/**
 * POST
 * Public API
 * Login a user
 */
exports.login = function(req, res, next) {
    var username = lib.removeNullsAndTrim(req.body.username);
    var password = lib.removeNullsAndTrim(req.body.password);
    var otp = lib.removeNullsAndTrim(req.body.otp);
    var remember = !!req.body.remember;
    var ipAddress = req.ip;
    var userAgent = req.get('user-agent');

    if (!username || !password)
        return res.render('login', { warning: 'no username or password' });

    database.validateUser(username, password, otp, function(err, userId) {
        if (err) {
            console.log('[Login] Error for ', username, ' err: ', err);

            if (err === 'NO_USER')
                return res.render('login',{ warning: 'Username does not exist' });
            if (err === 'WRONG_PASSWORD')
                return res.render('login', { warning: 'Invalid password' });
            if (err === 'INVALID_OTP') {
                var warning = otp ? 'Invalid one-time password' : undefined;
                return res.render('login-mfa', { username: username, password: password, warning: warning });
            }
            return next(new Error('Unable to validate user ' + username + ': \n' + err));
        }
        assert(userId);

        database.createSession(userId, ipAddress, userAgent, remember, function(err, sessionId, expires) {
            if (err)
                return next(new Error('Unable to create session for userid ' + userId +  ':\n' + err));

            if(remember)
                sessionOptions.expires = expires;

            res.cookie('id', sessionId, sessionOptions);
            res.redirect('/');
        });
    });
};

/**
 * POST
 * Logged API
 * Logout the current user
 */
exports.logout = function(req, res, next) {
    var sessionId = req.cookies.id;
    var userId = req.user.id;

    assert(sessionId && userId);

    database.expireSessionsByUserId(userId, function(err) {
        if (err)
            return next(new Error('Unable to logout got error: \n' + err));
        res.redirect('/');
    });
};
/*
POST: USERID
RESPONSE: GAMEID, GAMENAME, GAMEPRICE, GAMETYPE, USERNAME
*/
exports.getUserBid = function(req,res) => {
    
};


/*
POST: USERID, GAMEID
RESPONSE: TRUE/FALSE
*/
exports.setUserBid = function(req,res) => {
    
};

exports.getUserLuck = function(req, res){
    
}

exports.getUserXP = function(req, res){
    
}