/*
 Copyright (C) 2015  PencilBlue, LLC

 This program is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 This program is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

var async = require('async');
var url = require('url');
var util  = require('../../util.js');

module.exports = function SiteServiceModule(pb) {


    /**
     * Service for performing site specific operations.
     * @class SiteService
     * @constructor
     */
    function SiteService(){}

    SiteService.GLOBAL_SITE = 'global'; // represents default configuration, not actually a full site
    SiteService.NO_SITE = 'no-site';    // represents a site that doesn't exist
    SiteService.SITE_FIELD = 'site';
    SiteService.SITE_COLLECTION = 'site';
    var SITE_COLL = SiteService.SITE_COLLECTION;


    /**
     * Load full site config from the database using the unique id.
     * @method getByUid
     * @param {String} uid - unique id of site
     * @param {Function} cb - the callback function
     */
    SiteService.prototype.getByUid = function(uid, cb) {
        if(!uid || uid === SiteService.GLOBAL_SITE) {
            cb(null, {
                displayName:pb.config.siteName,
                hostname: pb.config.siteRoot,
                uid: SiteService.GLOBAL_SITE
            });
        }
        else {
            var dao = new pb.DAO();
            var where = {uid: uid};
            dao.loadByValues(where, SITE_COLL, cb);
        }
    };

    /**
     * Get all of the site objects in the database
     * @method getAllSites
     * @param {Function} cb - the callback function
     */
    SiteService.prototype.getAllSites = function(cb) {
        var dao = new pb.DAO();
        dao.q(SITE_COLL, { select: pb.DAO.SELECT_ALL, where: {} }, cb);
    };

    /**
     * Get all site objects where activated is true.
     * @method getActiveSites
     * @param {Function} cb - the callback function
     */
    SiteService.prototype.getActiveSites = function(cb) {
        var dao = new pb.DAO();
        dao.q(SITE_COLL, { select: pb.DAO.SELECT_ALL, where: {active: true} }, cb);
    };

    /**
     * Get all site objects where activated is false.
     * @method getInactiveSites
     * @param {Function} cb - the callback function
     */
    SiteService.prototype.getInactiveSites = function(cb) {
        var dao = new pb.DAO();
        dao.q(SITE_COLL, {where: {active: false}}, cb);
    };

    /**
     * Get all site objects segmented by active status.
     * @method getSiteMap
     * @param {Function} cb - the callback function
     */
    SiteService.prototype.getSiteMap = function(cb) {
        var self  = this;
        var tasks = {
             active: function(callback) {
                 self.getActiveSites(callback);
             },

             inactive: function(callback) {
                 self.getInactiveSites(callback);
             }
        };
        async.series(tasks, cb);
    };

    /**
     * Get site name given a unique id.
     * @method getSiteNameByUid
     * @param {String} uid - unique id
     * @param {Function} cb - the callback function
     */
    SiteService.prototype.getSiteNameByUid = function(uid, cb) {
        var dao = new pb.DAO();
        dao.q(SITE_COLL, {select: pb.DAO.SELECT_ALL, where: {uid: uid} }, function(err, result) {
            var siteName = (!uid || uid === SiteService.GLOBAL_SITE) ? 'global' : '';

            if (pb.util.isError(err)) {
                pb.log.error(err);
                return cb(err);
            }
            else if (result && result.length > 0) {
                siteName = result[0].displayName;
            }
            cb(null, siteName);
        });
    };

    /**
     * Checks to see if a proposed site display name or hostname is already in the system
     * @method isDisplayNameOrHostnameTaken
     * @param {String}   displayName - desired name to display
     * @param {String}   hostname - hostname of the site
     * @param {String}   id - Site object Id to exclude from the search
     * @param {Function} cb - Callback function
     */
    SiteService.prototype.isDisplayNameOrHostnameTaken = function(displayName, hostname, id, cb) {
        this.getExistingDisplayNameHostnameCounts(displayName, hostname, id, function(err, results) {

            var result = results === null;
            if (!result) {
                for(var key in results) {
                    result |= results[key] > 0;
                }
            }
            cb(err, result);
        });
    };


    /**
     * Gets the total counts of a display name and hostname in the site collection
     *
     * @method getExistingDisplayNameHostnameCounts
     * @param {String}   displayName - site display name
     * @param {String}   hostname - site hostname
     * @param {String}   id - Site object Id to exclude from the search
     * @param {Function} cb - Callback function
     */
    SiteService.prototype.getExistingDisplayNameHostnameCounts = function(displayName, hostname, id, cb) {
        if (util.isFunction(id)) {
            cb = id;
            id = null;
        }

        var getWhere = function(where) {
            if (id) {
                where[pb.DAO.getIdField()] = pb.DAO.getNotIDField(id);
            }
            return where;
        };
        var dao   = new pb.DAO();
        var tasks = {
            displayName: function(callback) {
                var expStr = '^' + util.escapeRegExp(displayName.toLowerCase()) + '$';
                dao.count('site', getWhere({displayName: new RegExp(expStr, 'i')}), callback);
            },
            hostname: function(callback) {
                dao.count('site', getWhere({hostname: hostname.toLowerCase()}), callback);
            }
        };
        async.parallel(tasks, cb);
    };

    /**
     * Determines if a site exists matching siteUid
     * @method siteExists
     * @param {String} siteUid - site unique id
     * @param {Function} cb - callback function
     */
    SiteService.siteExists = function(siteUid, cb) {
        var dao = new pb.DAO();
        dao.exists(SITE_COLL, {uid: siteUid}, function (err, exists) {
            cb(err, exists);
        });
    };

    /**
     * Run a job to activate a site so that all of its routes are available.
     * @method activateSite
     * @param {String} siteUid - site unique id
     * @param {Function} cb - callback to run after job is completed
     * @returns {String} the job id
     */
    SiteService.prototype.activateSite = function(siteUid, cb) {
        cb = cb || util.cb;
        var name = util.format("ACTIVATE_SITE_%s", siteUid);
        var job = new pb.SiteActivateJob();
        job.setRunAsInitiator(true);
        job.init(name);
        job.setSite(siteUid);
        job.run(cb);
        return job.getId();
    };


    /**
     * Run a job to set a site inactive so that only the admin routes are available.
     * @method deactivateSite
     * @param {String} siteUid - site unique id
     * @param {Function} cb - callback to run after job is completed
     * @returns {String} the job id
     */
    SiteService.prototype.deactivateSite = function(siteUid, cb) {
        cb = cb || util.cb;
        var name = util.format("DEACTIVATE_SITE_%s", siteUid);
        var job = new pb.SiteDeactivateJob();
        job.setRunAsInitiator(true);
        job.init(name);
        job.setSite(siteUid);
        job.run(cb);
        return job.getId();
    };

    /**
     * Creates a site and saves it to the database.
     * @method createSite
     * @param {Object} site - the configurable site object to save
     * @param {String} id - the site unique identifier for the database
     * @param {Function} cb - callback function
     */
    SiteService.prototype.createSite = function(site, id, cb) {
        site.active = false;
        site.uid = getUid();
        this.isDisplayNameOrHostnameTaken(site.displayName, site.hostname, id, function(err, isTaken, field) {
            if(util.isError(err) || isTaken) {
                cb(err, isTaken, field, null);
                return;
            }

            var dao = new pb.DAO();
            dao.save(site, function(err, result) {
                if(util.isError(err)) {
                    cb(err, false, null, null);
                    return;
                }

                cb(null, false, null, result);
            });
        });
    };

    /**
     * Given a site uid, activate if the site exists so that user facing routes are on.
     * @method startAcceptingSiteTraffic
     * @param {String} siteUid - site unique id
     * @param {Function} cb - callback function
     */
    SiteService.prototype.startAcceptingSiteTraffic = function(siteUid, cb) {
        var dao = new pb.DAO();
        dao.loadByValue('uid', siteUid, 'site', function(err, site) {
            if(util.isError(err)) {
                cb(err, null)
            } else if (!site) {
                cb(new Error('Site not found'), null);
            } else if (!site.active) {
                cb(new Error('Site not active'), null);
            } else {
                pb.RequestHandler.activateSite(site);
                cb(err, result)
            }
        });
    };

    /**
     * Given a site uid, deactivate if the site exists so that user facing routes are off.
     * @method stopAcceptingSiteTraffic
     * @param {String} siteUid - site unique id
     * @param {Function} cb - callback function
     */
    SiteService.prototype.stopAcceptingSiteTraffic = function(siteUid, cb) {
        var dao = new pb.DAO();
        dao.loadByValue('uid', siteUid, 'site', function(err, site) {
            if(util.isError(err)) {
                cb(err, null)
            } else if (!site) {
                cb(new Error('Site not found'), null);
            } else if (site.active) {
                cb(new Error('Site not deactivated'), null);
            } else {
                pb.RequestHandler.deactivateSite(site);
                cb(err, result)
            }
        });
    };

    /**
     * Load all sites into memory.
     * @method initSites
     * @param {Function} cb
     */
    SiteService.prototype.initSites = function(cb) {
        if (pb.config.multisite.enabled && !pb.config.multisite.globalRoot) {
            cb(new Error("A Global Hostname must be configured with multisite turned on."), false);
        }
        else {
            this.getAllSites(function (err, results) {
                if (err) {
                    cb(err);
                } else {
                    util.forEach(results, function (site) {
                        pb.RequestHandler.loadSite(site);
                    });
                    // To remain backwards compatible, hostname is siteRoot for single tenant
                    // and active allows all routes to be hit.
                    // When multisite, use the configured hostname for global, turn off public facing routes,
                    // and maintain admin routes (active is false).
                    pb.RequestHandler.loadSite({
                        displayName: pb.SiteService.GLOBAL_SITE,
                        uid: pb.SiteService.GLOBAL_SITE,
                        hostname: pb.config.multisite.enabled ? url.parse(pb.config.multisite.globalRoot).host : url.parse(pb.config.siteRoot).host,
                        active: pb.config.multisite.enabled ? false : true
                    });
                    cb(err, true);
                }
            });
        }
    };

    // Generate a site unique id.
    function getUid() {
        return pb.util.uniqueId();
    }

    /**
     * Runs a site activation job when command is received.
     * @static
     * @method onActivateSiteCommandReceived
     * @param {Object} command - the command to react to.
     */
    SiteService.onActivateSiteCommandReceived = function(command) {
        if (!util.isObject(command)) {
            pb.log.error('SiteService: an invalid activate_site command object was passed. %s', util.inspect(command));
            return;
        }

        var name = util.format("ACTIVATE_SITE_%s", command.site);
        var job = new pb.SiteActivateJob();
        job.setRunAsInitiator(false);
        job.init(name, command.jobId);
        job.setSite(command.site);
        job.run(function(err, result) {
            var response = {
                error: err ? err.stack : undefined,
                result: result ? true : false
            };
            pb.CommandService.getInstance().sendInResponseTo(command, response);
        });
    };

    /**
     * Runs a site deactivation job when command is received.
     * @static
     * @method onDeactivateSiteCommandReceived
     * @param {Object} command - the command to react to.
     */
    SiteService.onDeactivateSiteCommandReceived = function(command) {
        if (!util.isObject(command)) {
            pb.log.error('SiteService: an invalid deactivate_site command object was passed. %s', util.inspect(command));
            return;
        }

        var name = util.format("DEACTIVATE_SITE_%s", command.site);
        var job = new pb.SiteDeactivateJob();
        job.setRunAsInitiator(false);
        job.init(name, command.jobId);
        job.setSite(command.site);
        job.run(function(err, result) {
            var response = {
                error: err ? err.stack : undefined,
                result: result ? true : false
            };
            pb.CommandService.getInstance().sendInResponseTo(command, response);
        });
    };

    /**
     * Register activate and deactivate commands on initialization
     * @static
     * @method init
     */
    SiteService.init = function() {
        var commandService = pb.CommandService.getInstance();
        commandService.registerForType('deactivate_site', SiteService.onActivateSiteCommandReceived);
        commandService.registerForType('activate_site'  , SiteService.onDeactivateSiteCommandReceived);
    };

    /**
     * Returns true if siteid given is global or non-existant (to remain backwards compatible)
     * @method isGlobal
     * @param {String} siteid - the site id to check
     * @returns {Boolean} true if global or does not exist
     */
    SiteService.isGlobal = function (siteid) {
        return (!siteid || siteid === SiteService.GLOBAL_SITE);
    };

    /**
     * Returns true if both site ids given are equal
     * @method areEqual
     * @param {String} siteA - first site id to compare
     * @param {String} siteB - second site id to compare
     * @return {Boolean} true if equal, false otherwise
     */
    SiteService.areEqual = function (siteA, siteB) {
        if (SiteService.isGlobal(siteA) && SiteService.isGlobal(siteB)) {
            return true;
        }
        return siteA === siteB;
    };

    /**
     * Returns true if actual is not set (falsey) or logically equivalent to expected in terms of sites
     * @method isNotSetOrEqual
     * @param {String} actual - site to check
     * @param {String} expected - site you expect to be equal
     * @return {Boolean} true if actual exists and equals expected
     */
    SiteService.isNotSetOrEqual = function (actual, expected) {
        return !actual || SiteService.areEqual(actual, expected);
    };

    /**
     * Central place to get the current site. Backwards compatible cleansing
     * @method getCurrentSite
     * @param {String} siteid - site is to cleanse
     * @returns {String} SiteService.GLOBAL_SITE if not specified, or siteid otherwise
     */
    SiteService.getCurrentSite = function (siteid) {
        return siteid || SiteService.GLOBAL_SITE;
    };

    /**
     * Return site field from object.
     * @method getSiteFromObject
     * @param {Object} object
     * @returns {String} the value of the object's site field key
     */
    SiteService.getSiteFromObject = function (object) {
        if (!object) {
            return SiteService.NO_SITE;
        }
        return object[SiteService.SITE_FIELD];
    };

    /**
     * Determine whether http or https is being used for the site and return hostname attached to http(s)
     * @method getHostWithProtocol
     * @param {String} hostname
     * @returns {String} hostname with protocol attached
     */
    SiteService.getHostWithProtocol = function(hostname) {
        hostname = hostname.match(/^http/g) ? hostname : "//" + hostname;
        var urlObject = url.parse(hostname, false, true);
        urlObject.protocol = pb.config.server.ssl.enabled ? 'https' : 'http';
        return url.format(urlObject).replace(/\/$/, '');
    };

    return SiteService;
};