//@ts-check
/*
  Copyright: (c) 2026, ST-One Ltda.
  Node-RED nodes for CoDeSys V2.3 PLCs (read-only).
*/

function nrInputShim(node, fn) {
  node.on('input', function (msg, send, done) {
    send = send || node.send;
    done = done || (err => err && node.error(err, msg));
    fn(msg, send, done);
  });
}

/**
 * Compares values for equality, includes special handling for arrays
 * @param {any} a
 * @param {any} b
 */
function equals(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length != b.length) return false;

    for (var i = 0; i < a.length; ++i) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  return false;
}

/**
 * Name of the event emitted when a single variable changes. Variable names are
 * prefixed so they never collide with the internal events (__ALL__, __STATUS__, ...)
 * or with EventEmitter's special 'error' event
 * @param {string} name
 */
function varEvent(name) {
  return 'var:' + name;
}

var MIN_CYCLE_TIME = 50;

module.exports = function (RED) {
  "use strict";

  var codesys = require('@protocols/codesys-v2');
  var EventEmitter = require('events').EventEmitter;

  // ---------- CoDeSys Endpoint ----------

  function createTranslationTable(vars) {
    var res = {};

    (vars || []).forEach(function (elm) {
      if (!elm.name || !elm.addr) {
        //skip incomplete entries
        return;
      }
      res[elm.name] = elm.addr;
    });

    return res;
  }

  function generateStatus(status, val) {
    var obj;

    if (typeof val != 'string' && typeof val != 'number' && typeof val != 'boolean') {
      val = RED._("codesys.endpoint.status.online");
    }

    switch (status) {
      case 'online':
        obj = {
          fill: 'green',
          shape: 'dot',
          text: val.toString()
        };
        break;
      case 'badvalues':
        obj = {
          fill: 'yellow',
          shape: 'dot',
          text: RED._("codesys.endpoint.status.badvalues")
        };
        break;
      case 'offline':
        obj = {
          fill: 'red',
          shape: 'dot',
          text: RED._("codesys.endpoint.status.offline")
        };
        break;
      case 'connecting':
        obj = {
          fill: 'yellow',
          shape: 'dot',
          text: RED._("codesys.endpoint.status.connecting")
        };
        break;
      default:
        obj = {
          fill: 'grey',
          shape: 'dot',
          text: RED._("codesys.endpoint.status.unknown")
        };
    }
    return obj;
  }

  function CodesysEndpoint(config) {
    EventEmitter.call(this);
    var node = this;
    var oldValues = {};
    var status;
    var readInProgress = false;
    var readDeferred = 0;
    var connected = false;
    var currentCycleTime = config.cycletime;
    var itemGroup;

    RED.nodes.createNode(this, config);

    //avoids warnings when we have a lot of CoDeSys In nodes
    this.setMaxListeners(0);

    node.endpoint = null;
    node._vars = createTranslationTable(config.vartable);

    node.getStatus = function getStatus() {
      return status;
    };

    /**
     * updates the current cycle time on the fly. A value of 0
     * disables the cyclic reading of variables, and for positive values
     * a minimum of 50 ms is enforced
     *
     * @param {number} interval the cycle time interval, in ms
     * @returns {string|undefined} an string with the error if any, or undefined
     */
    node.updateCycleTime = function updateCycleTime(interval) {
      let time = parseInt(interval);

      if (isNaN(time) || time < 0) {
        return RED._("codesys.error.invalidtimeinterval", { interval: interval });
      }

      clearInterval(node._td);

      // don't set a new timer if value is zero
      if (!time) return;

      if (time < MIN_CYCLE_TIME) {
        node.warn(RED._("codesys.info.cycletimetooshort", { min: MIN_CYCLE_TIME }), {});
        time = MIN_CYCLE_TIME;
      }

      currentCycleTime = time;
      node._td = setInterval(doCycle, time);
    };

    function manageStatus(newStatus) {
      if (status == newStatus) return;

      status = newStatus;
      node.emit('__STATUS__', {
        status: status
      });
    }

    function cycleCallback(values) {
      readInProgress = false;

      if (readDeferred && connected) {
        doCycle();
        readDeferred = 0;
      }

      manageStatus('online');

      var changed = false;
      node.emit('__ALL__', values);
      Object.keys(values).forEach(function (key) {
        if (!equals(oldValues[key], values[key])) {
          changed = true;
          node.emit(varEvent(key), values[key]);
          node.emit('__CHANGED__', {
            key: key,
            value: values[key]
          });
          oldValues[key] = values[key];
        }
      });
      if (changed) node.emit('__ALL_CHANGED__', values);
    }

    function doCycle() {
      if (!readInProgress && connected) {
        itemGroup.readAllItems().then(cycleCallback).catch(e => {
          node.error(e, {});
          readInProgress = false;
          manageStatus('offline');
        });
        readInProgress = true;
      } else {
        readDeferred++;
      }
    }
    node.doCycle = doCycle;

    function onConnect() {
      readInProgress = false;
      readDeferred = 0;
      connected = true;

      node.log(RED._("codesys.info.connected", {
        address: config.address,
        port: config.port,
        target: node.endpoint.target,
        project: node.endpoint.project
      }));
      manageStatus('online');

      node.updateCycleTime(currentCycleTime);
    }

    function onDisconnect() {
      manageStatus('offline');
      connected = false;
      clearInterval(node._td);
    }

    node.on('close', done => {
      clearInterval(node._td);
      manageStatus('offline');
      if (itemGroup) itemGroup.destroy();
      if (!node.endpoint) return done();

      node.endpoint.disconnect().then(() => done()).catch(e => {
        node.error(e);
        done();
      });
    });

    manageStatus('offline');

    let varKeys = Object.keys(node._vars);
    if (!varKeys.length) {
      node.warn(RED._("codesys.info.novars"), {});
      return;
    }

    node.endpoint = new codesys.CodesysEndpoint({
      host: config.address,
      port: parseInt(config.port) || 1200,
      bigEndian: config.byteOrder === 'big',
      timeout: parseInt(config.timeout) || 3000
    });
    node.endpoint.on('connecting', () => manageStatus('connecting'));
    node.endpoint.on('connect', onConnect);
    node.endpoint.on('disconnect', onDisconnect);
    node.endpoint.on('error', (e => {
      manageStatus('offline');
      node.error(RED._("codesys.error.onconnect") + (e && e.toString()), {});
    }));

    itemGroup = new codesys.CodesysItemGroup(node.endpoint);
    itemGroup.setTranslationCB(k => node._vars[k]);

    try {
      itemGroup.addItems(varKeys);
    } catch (e) {
      node.error(RED._("codesys.error.invalidaddress", { error: e.message }), {});
    }
  }
  RED.nodes.registerType("codesys endpoint", CodesysEndpoint);

  // ---------- CoDeSys In ----------

  function CodesysIn(config) {
    var node = this;
    var statusVal;
    RED.nodes.createNode(this, config);

    node.endpoint = RED.nodes.getNode(config.endpoint);
    if (!node.endpoint) {
      return node.error(RED._("codesys.error.missingconfig"));
    }

    function sendMsg(data, key, status) {
      if (key === undefined) key = '';
      var msg = {
        payload: data,
        topic: key
      };
      statusVal = status !== undefined ? status : data;
      node.send(msg);
      node.status(generateStatus(node.endpoint.getStatus(), statusVal));
    }

    function onChanged(variable) {
      sendMsg(variable.value, variable.key, null);
    }

    function onDataSplit(data) {
      Object.keys(data).forEach(function (key) {
        sendMsg(data[key], key, null);
      });
    }

    function onData(data) {
      sendMsg(data, config.mode == 'single' ? config.variable : '');
    }

    function onDataSelect(data) {
      onData(data[config.variable]);
    }

    function onEndpointStatus(s) {
      node.status(generateStatus(s.status, statusVal));
    }

    node.status(generateStatus(node.endpoint.getStatus(), statusVal));
    node.endpoint.on('__STATUS__', onEndpointStatus);

    if (config.diff) {
      switch (config.mode) {
        case 'all-split':
          node.endpoint.on('__CHANGED__', onChanged);
          break;
        case 'single':
          node.endpoint.on(varEvent(config.variable), onData);
          break;
        case 'all':
        default:
          node.endpoint.on('__ALL_CHANGED__', onData);
      }
    } else {
      switch (config.mode) {
        case 'all-split':
          node.endpoint.on('__ALL__', onDataSplit);
          break;
        case 'single':
          node.endpoint.on('__ALL__', onDataSelect);
          break;
        case 'all':
        default:
          node.endpoint.on('__ALL__', onData);
      }
    }

    node.on('close', function (done) {
      node.endpoint.removeListener('__ALL__', onDataSelect);
      node.endpoint.removeListener('__ALL__', onDataSplit);
      node.endpoint.removeListener('__ALL__', onData);
      node.endpoint.removeListener('__ALL_CHANGED__', onData);
      node.endpoint.removeListener('__CHANGED__', onChanged);
      node.endpoint.removeListener('__STATUS__', onEndpointStatus);
      node.endpoint.removeListener(varEvent(config.variable), onData);
      done();
    });
  }
  RED.nodes.registerType("codesys in", CodesysIn);

  // ---------- CoDeSys Control ----------

  function CodesysControl(config) {
    var node = this;
    var statusVal;
    RED.nodes.createNode(this, config);

    node.endpoint = RED.nodes.getNode(config.endpoint);
    if (!node.endpoint) {
      return node.error(RED._("codesys.error.missingconfig"));
    }

    function onEndpointStatus(s) {
      node.status(generateStatus(s.status, statusVal));
    }

    function onMessage(msg, send, done) {
      var res;
      let func = config.function || msg.function;
      switch (func) {
        case 'cycletime':
          res = node.endpoint.updateCycleTime(msg.payload);
          if (res) {
            done(res);
          } else {
            send(msg);
            done();
          }
          break;
        case 'trigger':
          node.endpoint.doCycle();
          send(msg);
          done();
          break;
        default:
          done(RED._("codesys.error.invalidcontrolfunction", { function: func }));
      }
    }

    node.status(generateStatus(node.endpoint.getStatus(), statusVal));

    nrInputShim(node, onMessage);
    node.endpoint.on('__STATUS__', onEndpointStatus);

    node.on('close', function (done) {
      node.endpoint.removeListener('__STATUS__', onEndpointStatus);
      done();
    });
  }
  RED.nodes.registerType("codesys control", CodesysControl);
};
