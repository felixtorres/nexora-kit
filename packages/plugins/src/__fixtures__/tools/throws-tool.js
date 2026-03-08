export default {
  name: 'always_fails',
  description: 'A tool that always throws',
  parameters: { type: 'object', properties: {} },
  async handler() {
    throw new Error('boom');
  },
};
