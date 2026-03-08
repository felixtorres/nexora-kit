interface WeatherInput {
  city: string;
}

export default {
  name: 'get_weather',
  description: 'Get weather for a city',
  parameters: {
    type: 'object' as const,
    properties: {
      city: { type: 'string', description: 'City name' },
    },
    required: ['city'],
  },
  async handler(input: Record<string, unknown>) {
    const { city } = input as unknown as WeatherInput;
    return `Weather in ${city}: 22C, sunny`;
  },
};
