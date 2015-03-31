/*global chrome*/
(function() {


    ////////////////////////////////////////
    //  This script runs in the page!     //
    ////////////////////////////////////////

    var Deferred;
    if (window.FireBreathPromise) {
        Deferred = window.FireBreathPromise;
    }
    function makeDeferred(val) {
        var dfd = Deferred();
        dfd.resolve(val);
        return dfd;
    }

    var dfds = [];
    var listDfds = [];

    var wyrmholes = {};

    window.addEventListener("message", function(event) {
        // We only accept messages from ourselves
        if (event.source != window) { return; }

        if (event.data && event.data.list) {
            var listDfd = listDfds.pop();
            listDfd.resolve(event.data);
        } else if (event.data && event.data.source && (event.data.source == "host")) {
            handleEvent(event.data);
        }
    }, false);

    function handleEvent(evt) {
        var wh;
        if (evt.port && evt.message == "Created") {
            var dfd = dfds.pop();
            wh = new Wyrmhole(evt.port);
            dfd.resolve(wh);
        } else if (evt.port && evt.message == "Destroyed") {
            wh = wyrmholes[evt.port];
            wh.destroy();
        } else if (evt.port) {
            wh = wyrmholes[evt.port];
            wh.onMessage(evt);
        }
    }

    function createWyrmhole() {
        var dfd = Deferred();
        dfds.push(dfd);
        window.postMessage({
            source: "page",
            request: "Create"
        }, "*");
        return dfd.promise;
    }

    function Wyrmhole(port) {
        var loadDfd = null,
            self=this,
            destroyed = false,
            loaded = false,
            cmdMap = {},
            inMessages = {},
            nextCmdId = 1,
            onCommandFn = null;

        wyrmholes[port] = {
            onMessage: onMessage,
            destroy: function() {
                destroyed = true;
                delete wyrmholes[port];
            }
        };

        function postCommand(msg) {
            msg.source = "page";
            msg.port = port;
            window.postMessage(msg, "*");
        }
        function postMessage(msg, cmdId) {
            var type = "resp";
            if (cmdId === void 0) {
                cmdId = nextCmdId++;
                type = "cmd";
            }
            msg.c = 1; msg.n = 1;

            postCommand({
                cmdId: cmdId,
                type: type,
                c: 1, // This direction we don't need to split
                n: 1,
                colonyId: 0,
                msg: JSON.stringify(msg)
            });

            return cmdId;
        }

        function onMessage(msg) {
            if (msg.plugin && loadDfd && !loaded) {
                loaded = true;
                loadDfd.resolve(this);
            } else if (msg.error && loadDfd && !loaded) {
                loadDfd.reject(msg.error);
                loadDfd = void 0;
            } else if (msg.msg) {
                // This is a message from the native message host,
                // we might need to put it back together because the host
                // is limited to 1MB of data per message
                if (!inMessages[msg.cmdId]) {
                    inMessages[msg.cmdId] = {
                        parts: Array(msg.c),
                        count: 0
                    };
                }

                var obj = inMessages[msg.cmdId];
                obj.parts[msg.n-1] = msg.msg;
                obj.count++;
                if (obj.count >= msg.c) {
                    var text = obj.parts.join('');
                    processCompleteMessage(msg, text);
                }
            }
        }
        function processCompleteMessage(msg, text) {
            // The whole message is here!
            if (msg.type == "resp") {
                // This is a response to a message sent from the page
                var dfd = cmdMap[msg.cmdId];
                if (!dfd) {
                    throw new Error("Invalid msg id!");
                }
                try {
                    dfd.resolve(JSON.parse(text));
                } catch(e) {
                    // If the response was invalid, reject with that error
                    dfd.reject(e);
                }
            } else if (onCommandFn) {
                // This is a new message sent from the host to the page
                var promise;
                try {
                    promise = onCommandFn(JSON.parse(text));
                    if (!promise || !promise.then) {
                        // Invalid return value
                        throw new Error("Invalid value returned from wyrmhole message handler");
                    }
                    promise = makeDeferred(promise);
                } catch (e) {
                    postMessage(["error", {"error": "command exception", "message": e.toString()}]);
                }
                if (promise) {
                    promise.then(function(resp) {
                        // Send the return value
                        postMessage(resp);
                    }, function(e) {
                        postMessage(["error", {"error": "Javascript Exception", "message": e.toString()}]);
                    });
                }
            }
        }

        self.sendMessage = function(msg) {
            if (destroyed) {
                throw new Error("Wyrmhole not active");
            }
            var dfd = Deferred();
            var cmdId = postMessage(msg);
            cmdMap[cmdId] = dfd;

            return dfd.promise;
        };
        self.loadPlugin = function(mimetype) {
            if (loadDfd) {
                throw new Error("Plugin already loaded (or loading)");
            }
            loadDfd = Deferred();
            postCommand({
                cmd: "create",
                mimetype: mimetype
            });
            return loadDfd.promise;
        };
        self.destroy = function() {
            postCommand({
                cmd: "destroy"
            });
        };
        self.listPlugins = function() {
            var dfd = Deferred();
            listDfds.unshift(dfd);
            postCommand({"cmd": "list"});
            return dfd.promise.then(function(resp) {
                if (resp.status == "success") {
                    return resp.list;
                } else {
                    return Deferred().reject(resp.error);
                }
            });
        };
    }

    window.createWyrmhole = createWyrmhole;

})();
