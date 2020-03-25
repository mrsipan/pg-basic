const Context = require('context-eval');
const Parser = require('./parser');
const Functions = require('./functions');
const { ParseError, RuntimeError } = require('./errors');

class Basic {
  constructor({ console, debugLevel, display, constants = {
    PI: Math.PI,
    LEVEL: 1,
  } }) {
    this.debugLevel = debugLevel;
    this.console = console;
    this.context = new Context({
      __pgb: this,
    });
    this.variables = {};
    this.lineno = -1;
    this.program = [];
    this.loops = {};
    this.stack = [];
    this.jumped = false;
    this.display = display;
    this.constants = constants;
  }

  debug(str, level = 1) {
    if (this.debugLevel >= level) {
      console.log(`Debug ${this.lineno}:`, str);
    }
  }

  run(program) {
    return new Promise((resolve, reject) => {
      this.onEnd = { resolve, reject };
      this.ended = false;

      const seen = {};
      this.program = program.split('\n')
        .filter(l => l.trim() !== '')
        .map((l) => {
          try {
            return Parser.parseLine(l);
          } catch (e) {
            this.end(e);
          }
        })
        .sort((a, b) => a.lineno - b.lineno);

      if (this.ended) {
        return;
      }

      this.program.forEach(({ lineno }) => {
        if (seen[lineno]) {
          return this.end(new ParseError(lineno, `Line with number ${lineno} repeated`));
        }
        seen[lineno] = true;
      });

      if (!this.program.length) return this.end();

      this.lineno = this.program[0].lineno;

      this.execute();
    });
  }

  execute() {
    this.halted = false;
    while (true) {
      this.step();

      if (this.ended) return;

      if (!this.jumped) {
        const next = this.getNextLine();

        if (!next) {
          return this.end();
        }

        this.lineno = next.lineno;
      } else {
        this.jumped = false;
      }

      if (this.delay) {
        const delay = this.delay;
        this.delay = null;
        return setTimeout(() => {
          this.execute();
        }, delay)
      }

      if (this.halted) {
        return;
      }
    }
  }

  getCurLine() {
    return this.program.find(({ lineno }) => lineno === this.lineno);
  }

  getNextLine() {
    return this.program[this.program.indexOf(this.getCurLine()) + 1];
  }

  step() {
    const node = this.getCurLine();

    if (!node) {
      return this.end(new RuntimeError(this.lineno, `Cannot find line ${this.lineno} 🤦‍♂️`));
    }

    this.debug('step', 1);
    this.debug(node.toJSON(), 2);

    try {
      node.run(this);
    } catch (e) {
      this.end(e);
    }
  }

  end(error) {
    this.ended = true;

    if (error) {
      this.debug(`program ended with error: ${error.message}`);
      this.onEnd.reject(error);
    } else {
      this.debug('program ended');
      this.onEnd.resolve();
    }
  }

  evaluate(code) {
    try {
      return this.context.evaluate(code);
    } catch (e) {
      console.error('Error evaluating code:', code);
      throw e;
    }
  }

  set(vari, value) {
    this.variables[vari] = value;
  }

  setArray(vari, sub, value) {
    if (!(this.variables[vari] instanceof BasicArray)) {
      return this.end(new RuntimeError(this.lineno, `${vari} is not an array, did you call ARRAY?`));
    }
    this.variables[vari][sub] = value;
  }

  array(name) {
    this.variables[name] = new BasicArray();
  }

  fun(name) {
    if (!Functions[name]) {
      return this.end(new RuntimeError(this.lineno, `Function ${name} does not exist ☹️`));
    }

    // External functions
    switch (name.toLowerCase()) {
      case 'color':
        return this.color.bind(this);
      case 'getchar':
        return this.getChar.bind(this);
    }

    // Internal utils
    return Functions[name];
  }

  get(vari) {
    return this.variables[vari] || 0;
  }

  getConst(constant) {
    if (this.constants.hasOwnProperty(constant)) {
      return this.constants[constant]
    }
    this.end(new RuntimeError(this.lineno, `Constant ${constant} is undefined`));
  }

  pause(millis) {
    this.debug(`pause ${millis}`)
    this.delay = millis;
  }

  goto(lineno) {
    this.debug(`goto ${lineno}`)
    this.lineno = lineno;
    this.jumped = true;
  }

  loopStart({ variable, value, increment, max }) {
    this.debug(`marking loop ${variable}`)

    this.set(variable, value);
    const next = this.getNextLine();
    if (!next) return this.end();

    this.loops[variable] = {
      variable,
      value,
      increment,
      max,
      lineno: next.lineno,
    };
  }

  loopJump(name) {
    this.debug(`jumping to loop ${name}`);

    const loop = this.loops[name];
    loop.value += loop.increment;
    this.set(loop.variable, loop.value);

    if (loop.value >= loop.max) return;

    this.goto(loop.lineno);
  }

  gosub(lineno) {
    const next = this.getNextLine();
    if (next) {
      this.stack.push(next.lineno);
    } else {
      this.stack.push(this.lineno + 1);
    }
    this.goto(lineno);
  }

  return() {
    if (this.stack.length === 0) {
      return this.end(new RuntimeError(this.lineno, `There are no function calls to return from 🤷`));
    }
    const lineno = this.stack.pop();
    this.goto(lineno);
  }

  assertDisplay() {
    if (!this.display) {
      return this.end(new RuntimeError(this.lineno, 'No display found'));
    }
  }

  plot(x, y, color) {
    this.assertDisplay();
    this.display.plot(x, y, color);
  }

  color(x, y) {
    this.assertDisplay();
    return this.display.color(x, y);
  }

  clearAll() {
    this.clearConsole();
    this.clearGraphics();
  }

  print(s) {
    this.console.write(s.toString());
  }

  clearConsole() {
    this.console.clear();
  }

  clearGraphics() {
    this.assertDisplay();
    this.display.clear();
  }

  getChar() {
    this.assertDisplay();
    return this.display.getChar() || '';
  }

  input(callback) {
    this.console.input(callback);
  }

  halt() {
    this.halted = true;
  }
}

class BasicArray {
  toString() {
    let s = '';
    for (let prop in this) {
      if (this.hasOwnProperty(prop)) {
        s += `${prop}, `
      }
    }
    return s.replace(/,\s$/, '');
  }
}

module.exports = Basic;
