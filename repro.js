////////////////////////////////////////////////////////////////////////////////
// The global handler to debounce rendering.
////////////////////////////////////////////////////////////////////////////////

class ReproQueue {
  static active = true;
  debounceTimeout = null;
  debounceFrame = null;
  queue = [];
  templates = {};
  
  enqueue(reproTemplate){
    this.queue.push(reproTemplate);
    
    this.startQueue();
    
    return true;
  }
  
  startQueue(){
    if(!ReproQueue.active) return;
    
    if(this.debounceTimeout) clearTimeout(this.debounceTimeout);
    
    this.debounceTimeout = setTimeout(() => {
      if(this.debounceFrame) window.cancelAnimationFrame(this.debounceFrame);
      
      this.debounceFrame = window.requestAnimationFrame(this.processQueue.bind(this));
    }, 1);
  }
  
  processQueue(resolve){
    if(!ReproQueue.active) return;
    
    for(let i = 0; i < this.queue.length; i++){
      this.queue[i].renderQueueCallback();
    }
    
    this.queue.length = 0;
    this.debounceFrame = null;
    this.debounceFrame = null;
    
    document.dispatchEvent(new Event('template-render'));
  }
  
  static pause(){
    ReproQueue.active = false;
  }
  
  static resume(){
    ReproQueue.active = true;
    
    if(globalThis.repro){
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
  debounce;
  renderPromises = [];
  active = true;
  
  constructor(name, element, templateFunction, events = []){
    if(!globalThis.repro){
      globalThis.repro = new ReproQueue();
    }
    
    this.name = name;
    this.templateFunction = templateFunction;
    this.events = Array.isArray(events) ? events : (typeof events === 'string' ? [events] : []);
    this.setupElement(element);
    this.setupListeners();
    
    globalThis.repro.templates[this.name] = this;
  }
  
  setupElement(element){
    const isString = typeof element === 'string';
    this.isIdSelector = isString && element[0] === '#';
    
    if(isString){
      this.selector = element;
    }
    
    if(this.isIdSelector){
      this.isSingle = true;
      this.element = document.getElementById(this.selector.slice(1));
    } else if(isString){
      this.isSingle = false;
      this.elements = document.querySelectorAll(this.selector);
    } else if(Array.isArray(element)){
      this.isSingle = false;
      this.elements = element;
    } else {
      this.isSingle = true;
      this.element = element;
    }
  }
  
  setupListeners(){
    for(let i = 0; i < this.events.length; i++){
      document.addEventListener(this.events[i], this.render.bind(this));
    }
  }
  
  pause(){
    this.active = false;
  }
  
  resume(){
    this.active = true;
    this.render();
  }
  
  render(){
    if(this.debounce || !this.active) return;
    this.debounce = globalThis.repro.enqueue(this);
  }
  
  renderQueueCallback(){
    if(this.isSingle){
      if((!this.element || !this.element?.isConnected) && this.isIdSelector){
        this.element = document.getElementById(this.selector.slice(1));
      }
      
      if(this.element){
        const template = this.templateFunction();
        const renderPromise = this.renderEach(this.element, this.templateFunction());
        this.renderPromises.push(renderPromise);
      }
    } else {
      if((!this.elements || !this.elements.length) && this.selector){
        this.elements = document.querySelectorAll(this.selector);
      }
      
      if(this.elements.length){
        const template = this.templateFunction();
        for(let i = 0; i < this.elements.length; i++){
          const renderPromise = this.renderEach(this.elements[i], template);
          this.renderPromises.push(renderPromise);
        }
      }
    }
    
    if(this.renderPromises.length){
      Promise.all(this.renderPromises).then(() => {
        this.renderPromises.length = 0;
        this.debounce = null;
      });
    }
  }
  
  async renderEach(el, templateOrPromise){
    const isPromise = templateOrPromise && typeof templateOrPromise.then === 'function' && templateOrPromise[Symbol.toStringTag] === 'Promise';
    const template = isPromise ? await templateOrPromise : templateOrPromise;
    
    if(typeof template === 'string'){
      el.innerHTML = template;
    } else if(template instanceof Element){
      el.replaceChildren(template);
    } else if(Array.isArray(template)){
      el.innerHTML = '';
      for(let i = 0; i < template.length; i++){
        if(typeof template[i] === 'string'){
          el.insertAdjacentHTML('beforeend', template[i]);
        } else if(template[i] instanceof Element){
          el.insertAdjacentElement('beforeend', template[i]);
        }
      }
    }
  }
}


////////////////////////////////////////////////////////////////////////////////
// The proxy handler that fires events which ReproTemplate instances listen for.
////////////////////////////////////////////////////////////////////////////////

function proxyHandler(events = [], recursive = false, includeDetail = false){
  events = Array.isArray(events) ? events : (typeof events === 'string' ? [events] : []);
  
  let mute = false;
  
  return {
	  get(target, prop, receiver) {
		  if(prop === 'isProxy') return true;
      if(prop === 'target') return target;
      
		  if(recursive && isType(target[prop], ['object', 'array']) && !target[prop].isProxy){
			  target[prop] = new Proxy(target[prop], proxyHandler(events, recursive, includeDetail));
		  }
      
		  return target[prop];
	  },
    
	  set(target, prop, value, receiver) {
      if(prop === 'mute'){
        if(!!value){
          mute = true;
        } else {
          mute = false;
          dispatchEvents(events, includeDetail ? { target, prop, value, receiver, action: 'set' } : null);
        }
        return true;
      }
      
      // Return early if there is no change.
		  if(proxySafeCompare(target[prop], value)) return true;
      
      if(recursive && isType(value, ['object', 'array']) && !value.isProxy){
			  value = new Proxy(value, proxyHandler(events, recursive, includeDetail));
		  }
      
		  target[prop] = value;
      
      if(!mute){
        dispatchEvents(events, includeDetail ? { target, prop, value, receiver, action: 'set' } : null);
      }
      
		  return true;
	  },
    
	  deleteProperty(target, prop){
		  delete target[prop];
		  
      if(!mute){
        dispatchEvents(events, includeDetail ? { target, prop, action: 'delete' } : null);
      }
      
		  return true;
	  },
  };
};


////////////////////////////////////////////////////////////////////////////////
// Helper functions.
////////////////////////////////////////////////////////////////////////////////

function dispatchEvents(events = [], detail = null){
  for(let i = 0; i < events.length; i++){
    if(events[i] === 'store:company:list'){
      debugger;
    }
    if(detail === null){
      document.dispatchEvent(new Event(events[i]));
    } else {
      document.dispatchEvent(new CustomEvent(events[i], { detail }));
    }
  }
};

function parseHtml(str){
	return (new DOMParser())
	.parseFromString(`<body><template>${str}</template></body>`, 'text/html')
  .body.firstElementChild.content;
}

function getType(thing){
	return Object.prototype.toString.call(thing).slice(8, -1).toLowerCase();
}

function compareType(thing, type){
  switch(type){
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

function isType(thing, type){
  if(typeof type === 'string'){
    return compareType(thing, type);
  } else if(Array.isArray(type)){
    let isThingType = false;
    for(let i = 0; i < type.length; i++){
      if(compareType(thing, type[i])) return true;
    }
  }
  
  return false;
}

function proxySafeCompare(a, b){
  if(typeof a === 'object' && typeof b === 'object'){
    const aVal = a?.isProxy ? a.target : a;
    const bVal = b?.isProxy ? b.target : b;
    return aVal === bVal;
  }
  
  return a === b;
}

function pauseAll(){
  ReproQueue.pause();
}

function resumeAll(){
  ReproQueue.resume();
}


////////////////////////////////////////////////////////////////////////////////
// Exported functions to create targets and templates.
////////////////////////////////////////////////////////////////////////////////

function target(data = {}, events = [], recursive = false, includeDetail = false){
  return new Proxy(data, proxyHandler(events));
}

function template(name, element, templateFunction, events = []){
  const instance = new ReproTemplate(name, element, templateFunction, events);
  instance.render();
  return instance;
}

const Repro = { target, template, pauseAll, resumeAll, proxySafeCompare };

export default Repro;
