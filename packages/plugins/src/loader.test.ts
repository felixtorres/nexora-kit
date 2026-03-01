import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadPlugin, discoverPlugins } from './loader.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-plugin-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relativePath: string, content: string): void {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

describe('loadPlugin', () => {
  it('loads a valid plugin', () => {
    writeFile('plugin.yaml', `
name: Test Plugin
version: "1.0.0"
namespace: test-plugin
permissions:
  - llm:invoke
`);
    const result = loadPlugin(tmpDir);
    expect(result.errors).toHaveLength(0);
    expect(result.plugin.manifest.name).toBe('Test Plugin');
    expect(result.plugin.state).toBe('installed');
  });

  it('returns error when plugin.yaml is missing', () => {
    const result = loadPlugin(tmpDir);
    expect(result.plugin.state).toBe('errored');
    expect(result.errors[0]).toContain('No plugin.yaml');
  });

  it('returns error for invalid manifest', () => {
    writeFile('plugin.yaml', 'name: ""\n');
    const result = loadPlugin(tmpDir);
    expect(result.plugin.state).toBe('errored');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('discovers skill YAML files as tools', () => {
    writeFile('plugin.yaml', `
name: Skill Plugin
version: "1.0.0"
namespace: skill-plugin
`);
    writeFile('skills/greet.yaml', `
name: greet
description: Greet a user
parameters:
  name:
    type: string
    description: User name
`);
    writeFile('skills/farewell.yaml', `
name: farewell
description: Say goodbye
`);

    const result = loadPlugin(tmpDir);
    expect(result.plugin.tools).toHaveLength(2);
    const names = result.plugin.tools.map((t) => t.name).sort();
    expect(names).toEqual(['skill-plugin:farewell', 'skill-plugin:greet']);
    const greetTool = result.plugin.tools.find((t) => t.name === 'skill-plugin:greet')!;
    expect(greetTool.parameters.properties.name.type).toBe('string');
  });

  it('handles malformed skill YAML gracefully', () => {
    writeFile('plugin.yaml', `
name: Bad Skills
version: "1.0.0"
namespace: bad-skills
`);
    writeFile('skills/good.yaml', `
name: good
description: A good skill
invocation: model
`);
    writeFile('skills/bad.yaml', '{{{invalid yaml');

    const result = loadPlugin(tmpDir);
    expect(result.plugin.tools).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('bad.yaml');
  });

  it('skips skill files without name or description', () => {
    writeFile('plugin.yaml', `
name: Incomplete
version: "1.0.0"
namespace: incomplete
`);
    writeFile('skills/noname.yaml', 'description: Missing name');
    writeFile('skills/nodesc.yaml', 'name: missing-desc');

    const result = loadPlugin(tmpDir);
    expect(result.plugin.tools).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
  });

  it('validates namespace format', () => {
    writeFile('plugin.yaml', `
name: Bad NS
version: "1.0.0"
namespace: Bad-Namespace
`);
    const result = loadPlugin(tmpDir);
    // Zod will reject uppercase namespace
    expect(result.plugin.state).toBe('errored');
  });

  it('works with no skills directory', () => {
    writeFile('plugin.yaml', `
name: No Skills
version: "1.0.0"
namespace: no-skills
`);
    const result = loadPlugin(tmpDir);
    expect(result.plugin.tools).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('handles .yml extension for skills', () => {
    writeFile('plugin.yaml', `
name: Yml
version: "1.0.0"
namespace: yml-plugin
`);
    writeFile('skills/search.yml', `
name: search
description: Search things
invocation: model
`);

    const result = loadPlugin(tmpDir);
    expect(result.plugin.tools).toHaveLength(1);
    expect(result.plugin.tools[0].name).toBe('yml-plugin:search');
  });

  it('returns skill definitions from skill files', () => {
    writeFile('plugin.yaml', `
name: Skill Defs
version: "1.0.0"
namespace: skill-defs
`);
    writeFile('skills/greet.yaml', `
name: greet
description: Greet user
invocation: model
parameters:
  userName:
    type: string
    description: Name of user
prompt: "Hello {{userName}}"
`);

    const result = loadPlugin(tmpDir);
    expect(result.skillDefinitions.size).toBe(1);
    const skillDef = result.skillDefinitions.get('skill-defs:greet');
    expect(skillDef).toBeDefined();
    expect(skillDef!.prompt).toContain('{{userName}}');
    expect(skillDef!.invocation).toBe('model');
  });

  it('discovers markdown skill files', () => {
    writeFile('plugin.yaml', `
name: MD Skills
version: "1.0.0"
namespace: md-skills
`);
    writeFile('skills/summarize.md', `---
name: summarize
description: Summarize text
---
Please summarize: {{text}}`);

    const result = loadPlugin(tmpDir);
    expect(result.plugin.tools).toHaveLength(1);
    expect(result.plugin.tools[0].name).toBe('md-skills:summarize');
    expect(result.skillDefinitions.get('md-skills:summarize')!.prompt).toContain('{{text}}');
  });

  it('discovers command YAML files', () => {
    writeFile('plugin.yaml', `
name: Cmd Plugin
version: "1.0.0"
namespace: cmd-plugin
`);
    writeFile('commands/hello.yaml', `
name: hello
description: Say hello
args:
  - name: name
    type: string
    default: World
`);

    const result = loadPlugin(tmpDir);
    expect(result.commandDefinitions.size).toBe(1);
    const cmdDef = result.commandDefinitions.get('cmd-plugin:hello');
    expect(cmdDef).toBeDefined();
    expect(cmdDef!.args).toHaveLength(1);
    expect(cmdDef!.args[0].default).toBe('World');
  });

  it('handles malformed command YAML gracefully', () => {
    writeFile('plugin.yaml', `
name: Bad Cmds
version: "1.0.0"
namespace: bad-cmds
`);
    writeFile('commands/bad.yaml', '{{{invalid yaml');

    const result = loadPlugin(tmpDir);
    expect(result.commandDefinitions.size).toBe(0);
    expect(result.errors).toContainEqual(expect.stringContaining('bad.yaml'));
  });
});

describe('discoverPlugins', () => {
  it('discovers plugins in subdirectories', () => {
    writeFile('plugin-a/plugin.yaml', `
name: Plugin A
version: "1.0.0"
namespace: plugin-a
`);
    writeFile('plugin-b/plugin.yaml', `
name: Plugin B
version: "1.0.0"
namespace: plugin-b
`);
    writeFile('not-a-plugin/readme.md', 'nothing');

    const results = discoverPlugins(tmpDir);
    expect(results).toHaveLength(2);
    const namespaces = results.map((r) => r.plugin.manifest.namespace);
    expect(namespaces).toContain('plugin-a');
    expect(namespaces).toContain('plugin-b');
  });

  it('returns empty for nonexistent directory', () => {
    const results = discoverPlugins('/nonexistent/path');
    expect(results).toEqual([]);
  });
});
