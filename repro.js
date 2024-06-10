////////////////////////////////////////////////////////////////////////////////
// The global handler to debounce rendering.
////////////////////////////////////////////////////////////////////////////////

class ReproQueue {
  debounce;
  queue = [];
  
  enqueue(callback){
    if(this.debounce) window.cancelAnimationFrame(this.debounce);
    
    this.debounce = window.requestAnimationFrame(this.processQueue.bind(this));
    
    this.queue.push(callback);
    
    return this.debounce;
  }
  
  async processQueue(){
    for(let i = 0; i < this.queue.length; i++){
      await this.queue[i]();
    }
    
    this.queue.length = 0;
    this.debounce = null;
    document.dispatchEvent(new Event('template-render'));
  }
}


////////////////////////////////////////////////////////////////////////////////
// The reactive template class that listens for events to trigger a render.
////////////////////////////////////////////////////////////////////////////////

class ReproTemplate {
  element;
  elements;
  selector;
  isIdSelector;
  isSingle;
  templateFunction;
  events;
  debounce;
  
  constructor(element, templateFunction, events = []){
    if(!globalThis.repro){
      globalThis.repro = new ReproQueue();
    }
    
    this.templateFunction = templateFunction;
    this.events = Array.isArray(events) ? events : (typeof events === 'string' ? [events] : []);
    this.setupElement(element);
    this.activate();
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
  
  activate(){
    for(let i = 0; i < this.events.length; i++){
      document.addEventListener(this.events[i], this.render.bind(this));
    }
  }
  
  deactivate(){
    for(let i = 0; i < this.events.length; i++){
      document.removeEventListener(this.events[i], this.render.bind(this));
    }
  }
  
  render(){
    if(this.debounce) return;
    this.debounce = globalThis.repro.enqueue(this.renderQueueCallback.bind(this));
  }
  
  async renderQueueCallback(){
    if(this.isSingle){
      if((!this.element || !this.element?.isConnected) && this.isIdSelector){
        this.element = document.getElementById(this.selector.slice(1));
      }
      
      if(this.element){
        const template = this.templateFunction();
        await this.renderEach(this.element, this.templateFunction());
      }
    } else {
      if((!this.elements || !this.elements.length) && this.selector){
        this.elements = document.querySelectorAll(this.selector);
      }
      
      if(this.elements.length){
        const template = this.templateFunction();
        for(let i = 0; i < this.elements.length; i++){
          await this.renderEach(this.elements[i], template);
        }
      }
    }
    
    this.debounce = null;
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
// The proxy handler that fires events which ReproxTemplate instances lisen for.
////////////////////////////////////////////////////////////////////////////////

function proxyHandler(events = [], includeDetail = false){
  events = Array.isArray(events) ? events : (typeof events === 'string' ? [events] : []);
  
  return {
	  get(target, prop, receiver) {
		  if(prop === 'isProxy') return true;
      
		  if(isType(target[prop], ['object', 'array']) && !target[prop].isProxy){
			  target[prop] = new Proxy(target[prop], proxyHandler(events, includeDetail));
		  }
      
		  return target[prop];
	  },
    
	  set(target, prop, value, receiver) {
		  if(target[prop] === value) return true;
      
      if(isType(value, ['object', 'array']) && !value.isProxy){
			  value = new Proxy(value, proxyHandler(events));
		  }
      
		  target[prop] = value;
      
      dispatchEvents(events, includeDetail ? { target, prop, value, receiver, action: 'set' } : null);
      
		  return true;
	  },
    
	  deleteProperty(target, prop){
		  delete target[prop];
		  
      dispatchEvents(events, includeDetail ? { target, prop, action: 'delete' } : null);
      
		  return true;
	  },
  };
};


////////////////////////////////////////////////////////////////////////////////
// Helper functions.
////////////////////////////////////////////////////////////////////////////////

function dispatchEvents(events = [], detail = null){
  for(let i = 0; i < events.length; i++){
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


////////////////////////////////////////////////////////////////////////////////
// Exported functions to create targets and templates.
////////////////////////////////////////////////////////////////////////////////

function target(data = {}, events = []){
  return new Proxy(data, proxyHandler(events));
}

function template(element, templateFunction, events = []){
  const instance = new ReproTemplate(element, templateFunction, events);
  instance.render();
  return instance;
}

const Repro = { target, template };

export default Repro;
