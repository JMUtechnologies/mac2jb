// Compatibility API: the implementation is provided by a module.
module.exports = {async create(...args) {return (await require('../components.cjs').get('controllers', 'controller')).create(...args);}};
