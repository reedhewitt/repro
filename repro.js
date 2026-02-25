////////////////////////////////////////////////////////////////////////////////
// Class to diff DOM elements in place.
////////////////////////////////////////////////////////////////////////////////

class Diff {
  static diffAttributes(template, existing) {
    if (template.nodeType !== 1) return;

    let templateAtts = template.attributes;
    let existingAtts = existing.attributes;

    for (let { name, value } of Array.from(templateAtts)) {
      const isBoolAttr = ['checked', 'selected', 'required', 'disabled', 'readonly'].includes(name);

      if (isBoolAttr) {
        const isFalseVal = ['false', 'null', 'undefined', '0', 'NaN'].includes(value);

        if (isFalseVal) {
          existing.removeAttribute(name);
        } else {
          existing.setAttribute(name, name);
        }

        continue;
      }

      if (name === 'value') {
        existing.value = value;
        continue;
      }

      existing.setAttribute(name, value);
    }

    for (let { name, value } of Array.from(existingAtts)) {
      if (templateAtts[name]) continue;

      if (name === 'value') {
        existing.value = '';
        continue;
      }

      existing.removeAttribute(name);
    }
  }

  static getNodeContent(node) {
    return node.childNodes && node.childNodes.length ? null : node.textContent;
  }

  static isDifferentNode(node1, node2) {
    return (
      (typeof node1.nodeType === 'number' && node1.nodeType !== node2.nodeType)
      || (typeof node1.tagName === 'string' && node1.tagName !== node2.tagName)
      || (typeof node1.id === 'string' && !!node1.id && node1.id !== node2.id)
      || ('getAttribute' in node1 && 'getAttribute' in node2 && node1.getAttribute('key') !== node2.getAttribute('key'))
      || (typeof node1.src === 'string' && !!node1.src && node1.src !== node2.src)
    );
  }

  static aheadInTree(node, existing) {
    if (node.nodeType !== 1) return;

    let id = node.getAttribute('id');
    if (!id) return;

    return existing.querySelector(`:scope > #${id}`);
  }

  static trimExtraNodes(existingNodes, templateNodes) {
    let extra = existingNodes.length - templateNodes.length;
    if (extra < 1) return;
    for (; extra > 0; extra--) {
      existingNodes[existingNodes.length - 1].remove();
    }
  }

  static apply(template, existing) {
    if (typeof document === 'undefined') return;

    let templateNodes = typeof template === 'string' ? parseHtml(template).childNodes : template.childNodes;

    const diffId = Math.floor(Math.random() * 1000);

    let existingNodes = existing.childNodes;

    for (let index = 0; index < templateNodes.length; index++) {
      const node = templateNodes[index];
      const existingNode = existingNodes[index] ?? null;

      // If there's no existing element, create and append
      if (!existingNode) {
        existing.append(node.cloneNode(true));
        continue;
      }

      // If there is, but it's not the same node type...
      if (Diff.isDifferentNode(node, existingNode)) {
        // Check if node exists further in the tree
        let ahead = Diff.aheadInTree(node, existing);

        // If not, insert the new node before the current one
        if (!ahead) {
          existingNode.before(node.cloneNode(true));
          continue;
        }

        // Otherwise, move existing node to the current spot
        existingNode.before(ahead);
      }

      // If attributes are different, update them
      Diff.diffAttributes(node, existingNode);

      // Stop diffing if a native web component
      if (node.nodeName.includes('-')) continue;

      // If content is different, update it
      let templateContent = Diff.getNodeContent(node);
      if (templateContent !== Diff.getNodeContent(existingNode)) {
        existingNode.textContent = templateContent ? templateContent : '';
      }

      // If there shouldn't be child nodes but there are, remove them
      if (!node.childNodes.length && existingNode.childNodes.length) {
        existingNode.innerHTML = '';
        continue;
      }

      // If DOM is empty and shouldn't be, build it up
      // This uses a document fragment to minimize reflows
      if (!existingNode.childNodes.length && node.childNodes.length) {
        let fragment = document.createDocumentFragment();
        Diff.apply(node, fragment);
        existingNode.appendChild(fragment);
        continue;
      }

      // If there are nodes within it, recursively diff those
      if (node.childNodes.length) {
        Diff.apply(node, existingNode);
      }
    }

    // If extra elements in DOM, remove them
    Diff.trimExtraNodes(existingNodes, templateNodes);
  }
}

////////////////////////////////////////////////////////////////////////////////
// Helper functions.
////////////////////////////////////////////////////////////////////////////////

function dispatchEvents(events = [], detail = null) {
  if (typeof document === 'undefined') return;

  for (let i = 0; i < events.length; i++) {
    if (detail === null) {
      document.dispatchEvent(new Event(events[i]));
    } else {
      document.dispatchEvent(new CustomEvent(events[i], { detail }));
    }
  }
}

function parseHtml(str) {
  return (new DOMParser())
    .parseFromString(`<body><template>${str}</template></body>`, 'text/html')
    .body.firstElementChild.content;
}

function getType(thing) {
  return Object.prototype.toString.call(thing).slice(8, -1).toLowerCase();
}

function compareType(thing, type) {
  switch (type) {
    case 'undefined':
    case 'boolean':
    case 'number':
    case 'bigint':
    case 'string':
    case 'symbol':
    case 'function':
      return typeof thing === type;
    default:
      return getType(thing) === type;
  }
}

function isType(thing, type) {
  if (typeof type === 'string') {
    return compareType(thing, type);
  } else if (Array.isArray(type)) {
    let isThingType = false;
    for (let i = 0; i < type.length; i++) {
      if (compareType(thing, type[i])) return true;
    }
  }

  return false;
}

function proxySafeCompare(a, b) {
  if (typeof a === 'object' && typeof b === 'object') {
    const aVal = a?.isProxy ? a.target : a;
    const bVal = b?.isProxy ? b.target : b;
    return aVal === bVal;
  }

  return a === b;
}

function pauseAll() {
  ReproQueue.pause();
}

function resumeAll() {
  ReproQueue.resume();
}

function isActive() {
  return ReproQueue.active;
}

function isPaused() {
  return !ReproQueue.active;
}

////////////////////////////////////////////////////////////////////////////////
// The global handler to debounce rendering.
////////////////////////////////////////////////////////////////////////////////

class ReproQueue {
  static active = true;
  debounceTimeout = null;
  debounceFrame = null;
  queue = new Set();
  templates = {};

  enqueue(reproTemplate) {
    if (!reproTemplate.active) return false;

    this.queue.add(reproTemplate);

    this.startQueue();

    return true;
  }

  startQueue() {
    if (!ReproQueue.active) return;

    if (this.debounceTimeout) clearTimeout(this.debounceTimeout);

    this.debounceTimeout = setTimeout(() => {
      if (this.debounceFrame) window.cancelAnimationFrame(this.debounceFrame);

      this.debounceFrame = window.requestAnimationFrame(this.processQueue.bind(this));
    }, 1);
  }

  processQueue(resolve) {
    if (!ReproQueue.active || typeof document === 'undefined') return;

    const namedEventDispatchers = new Map();

    for (const reproTemplate of this.queue) {
      if (!reproTemplate.active) {
        reproTemplate.debounce = false;
        continue;
      }

      const renderPromise = reproTemplate.renderQueueCallback();

      if (renderPromise) {
        const name = reproTemplate.name;
        const dispatcher = () => document.dispatchEvent(new Event(`template-render-${name}`));
        namedEventDispatchers.set(name, () => renderPromise.then(dispatcher));
      }
    }

    this.queue.clear();
    this.debounceFrame = null;
    this.debounceFrame = null;

    requestAnimationFrame(() => {
      document.dispatchEvent(new Event('template-render'));
      for (const namedEventDispatcher of namedEventDispatchers.values()) {
        namedEventDispatcher();
      }
    });
  }

  static pause() {
    ReproQueue.active = false;
  }

  static resume() {
    ReproQueue.active = true;

    if (globalThis.repro) {
      globalThis.repro.startQueue();
    }
  }
}

////////////////////////////////////////////////////////////////////////////////
// The reactive template class that listens for events to trigger a render.
////////////////////////////////////////////////////////////////////////////////

class ReproTemplate {
  name;
  element;
  elements;
  selector;
  isIdSelector;
  isSingle;
  templateFunction;
  events;
  renderId;
  debounce;
  renderPromises = [];
  active = true;

  constructor(name, element, templateFunction, events = [], startPaused = false) {
    if (!globalThis.repro) {
      globalThis.repro = new ReproQueue();
    }

    this.name = name;
    this.templateFunction = templateFunction;
    this.events = Array.isArray(events) ? events : (typeof events === 'string' ? [events] : []);
    this.active = !startPaused;
    this.setupElement(element);
    this.setupListeners();

    globalThis.repro.templates[this.name] = this;
  }

  setupElement(element) {
    if (typeof document === 'undefined') return;

    const isString = typeof element === 'string';
    this.isIdSelector = isString && element[0] === '#';

    if (isString) {
      this.selector = element;
    }

    if (this.isIdSelector) {
      this.isSingle = true;
      this.element = document.getElementById(this.selector.slice(1));
    } else if (isString) {
      this.isSingle = false;
      this.elements = document.querySelectorAll(this.selector);
    } else if (Array.isArray(element)) {
      this.isSingle = false;
      this.elements = element;
    } else {
      this.isSingle = true;
      this.element = element;
    }
  }

  setupListeners() {
    if (typeof document === 'undefined') return;

    for (let i = 0; i < this.events.length; i++) {
      document.addEventListener(this.events[i], this.render.bind(this));
    }
  }

  pause() {
    this.active = false;
  }

  resume(doRender = true) {
    this.active = true;
    if (doRender) this.render();
  }

  render() {
    if (this.debounce || !this.active) return;
    this.renderId = globalThis.crypto.randomUUID();
    this.debounce = globalThis.repro.enqueue(this);
  }

  async runTemplateFunction() {
    const renderId = this.renderId;
    const result = await this.templateFunction();
    if (renderId === this.renderId) return result;
    return null;
  }

  renderQueueCallback() {
    if (typeof document === 'undefined') return;

    this.renderPromises.length = 0;

    if (this.isSingle) {
      if ((!this.element || !this.element?.isConnected) && this.isIdSelector) {
        this.element = document.getElementById(this.selector.slice(1));
      }

      if (this.element) {
        const renderPromise = this.renderEach(this.element, this.runTemplateFunction());
        this.renderPromises.push(renderPromise);
      }
    } else {
      if ((!this.elements || !this.elements.length) && this.selector) {
        this.elements = document.querySelectorAll(this.selector);
      }

      if (this.elements.length) {
        const template = this.runTemplateFunction();
        for (let i = 0; i < this.elements.length; i++) {
          const renderPromise = this.renderEach(this.elements[i], template);
          this.renderPromises.push(renderPromise);
        }
      }
    }

    if (this.renderPromises.length) {
      const renderId = this.renderId;
      const renderPromise = Promise.all(this.renderPromises);
      renderPromise.then(() => {
        if (renderId !== this.renderId) return;
        this.renderPromises.length = 0;
        this.debounce = null;
        this.renderId = null;
      });
      return renderPromise;
    }

    return null;
  }

  async renderEach(el, templateOrPromise) {
    if (templateOrPromise === null) return;
    const isPromise = templateOrPromise && typeof templateOrPromise.then === 'function'
      && templateOrPromise[Symbol.toStringTag] === 'Promise';
    const template = isPromise ? await templateOrPromise : templateOrPromise;
    Diff.apply(template, el);
  }
}

////////////////////////////////////////////////////////////////////////////////
// The proxy handler that fires events which ReproTemplate instances listen for.
////////////////////////////////////////////////////////////////////////////////

function proxyHandler(events = [], recursive = false, includeDetail = false, muteController = null) {
  events = Array.isArray(events) ? events : (typeof events === 'string' ? [events] : []);

  // This will be passed by reference to recursive proxies so that they inherit the mute state.
  if (!muteController || typeof muteController !== 'object' || typeof muteController.mute !== 'boolean') {
    muteController = { mute: false };
  }

  const mutatorMethods = new Set(['add', 'clear', 'delete', 'set']);

  return {
    get(target, prop, receiver) {
      if (prop === 'isProxy') return true;
      if (prop === 'target') return target;

      if (target[prop] instanceof Function) {
        return function(...args) {
          const result = target[prop].apply(this === receiver ? target : this, args);

          const isMap = target instanceof Map;
          const isSet = target instanceof Set;
          if (!muteController.mute && (isMap || isSet) && mutatorMethods.has(prop)) {
            const key = isMap && args.length ? args[0] : null;
            const value = isMap && args.length > 1 ? args[1] : (isSet && args.length ? args[0] : null);
            const detail = { action: prop };
            if (key !== null) detail.key = key;
            if (value !== null) detail.value = value;
            dispatchEvents(events, includeDetail ? detail : null);
          }

          return result;
        };
      }

      if (recursive && isType(target[prop], ['object', 'array']) && !target[prop].isProxy) {
        target[prop] = new Proxy(target[prop], proxyHandler(events, recursive, includeDetail, muteController));
      }

      return target[prop];
    },

    set(target, prop, value, receiver) {
      if (prop === 'mute') {
        muteController.mute = !!value;
        if (!muteController.mute) {
          dispatchEvents(events, includeDetail ? { prop, value, action: 'delete' } : null);
        }
        return true;
      }

      // Return early if there is no change.
      if (proxySafeCompare(target[prop], value)) return true;

      if (recursive && isType(value, ['object', 'array']) && !value.isProxy) {
        value = new Proxy(value, proxyHandler(events, recursive, includeDetail, muteController));
      }

      target[prop] = value;

      if (!muteController.mute) {
        dispatchEvents(events, includeDetail ? { prop, value } : null);
      }

      return true;
    },

    deleteProperty(target, prop) {
      delete target[prop];

      if (!muteController.mute) {
        dispatchEvents(events, includeDetail ? { prop, action: 'delete' } : null);
      }

      return true;
    },
  };
}

////////////////////////////////////////////////////////////////////////////////
// Exported functions to create targets and templates.
////////////////////////////////////////////////////////////////////////////////

function target(data = {}, events = [], recursive = false, includeDetail = false) {
  return new Proxy(data, proxyHandler(events, recursive, includeDetail));
}

function template(name, element, templateFunction, events = [], startPaused = false) {
  const instance = new ReproTemplate(name, element, templateFunction, events, startPaused);
  if (!startPaused) instance.render();
  return instance;
}

const Repro = { isActive, isPaused, pauseAll, proxySafeCompare, resumeAll, target, template };

export default Repro;
export { isActive, isPaused, pauseAll, proxySafeCompare, resumeAll, target, template };
