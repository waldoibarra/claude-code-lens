import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const

type Bottom = { ids: string[]; whileRunning?: (e: { tool: string }) => Promise<void> }

// What the engine would do beneath the plugin: draw `ENGINE`, run tools.
function engineBottom(on: On): Bottom {
  const bottom: Bottom = { ids: [] }
  mock.clock(on, { now: Date.UTC(2026, 9, 8, 15, 4) })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('tool.call', async ($, e) => {
    if (e.tool_use_id) bottom.ids.push(e.tool_use_id)
    await bottom.whileRunning?.(e)
    if (e.tool === 'Bash' && e.command.includes('fail')) {
      return { deny: 'Exit code 1\nnpm ERR! Missing script: "tset"' }
    }
    if (e.tool === 'Read') return { result: { type: 'text', file: { numLines: 12 } } }
    if (e.tool === 'Edit')
      return {
        result: {
          structuredPatch: [
            { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-x', '+y'] },
          ],
        },
      }
    if (e.tool === 'Bash')
      return {
        result: {
          stdout: e.command.includes('quiet') ? '' : 'hello\n',
          stderr: '',
          interrupted: false,
        },
      }
    if (e.tool === 'Agent')
      return {
        result: { agentId: 'helper-1', resolvedModel: 'claude-haiku-5-5', totalDurationMs: 6200 },
      }
    return { result: {} }
  })
  return bottom
}

// One turn: read two files, a reply, then a failing command and an edit.
async function playTurn($: Engine, bottom: Bottom) {
  await $.turn.start({ text: 'fix it', turnId: 'turn-1' })
  await $.tool.call({ tool: 'Read', file_path: '/Users/me/app/src/a.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/Users/me/app/src/b.ts' })
  await $.session.append({
    door: 'response',
    uuid: 'reply-1',
    origin: { kind: 'model', model: 'claude-opus-5-5' },
    message: {
      type: 'assistant',
      role: 'assistant',
      content: [{ type: 'text', text: 'Running the tests now.' }],
    },
  } as never)
  await $.tool.call({
    tool: 'Bash',
    command: 'npm run tset -- --fail',
    description: 'Run the tests',
  })
  await $.tool.call({
    tool: 'Edit',
    file_path: '/Users/me/app/src/a.ts',
    old_string: 'x',
    new_string: 'y',
  })
  expect(bottom.ids).toHaveLength(4)
  return bottom.ids
}

const toolRow = (id: string, tool: string, input: unknown) => ({
  tool_use_id: id,
  tool,
  input,
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: {},
})

describe('lens rendering', () => {
  test('clean draws one lean line per run', async ($, on) => {
    const steps = await playTurn($, engineBottom(on))
    await $.command.run({ command: 'lens', args: 'clean' } as never)
    for (const surface of SURFACES) {
      const mount = (id: string, tool: string) =>
        $.ui.mount({
          plugin: 'lens',
          surface,
          component: 'ToolUse',
          requestId: id,
          props: toolRow(id, tool, {}),
        })

      // Run 1: the two reads.
      const runOne = await mount(steps[0]!, 'Read')
      expect((await runOne.find({ key: 'toggle' }))?.text).toBe('▸ 2 steps')
      // Run 1 came before any reply row: the gray label names no model.
      expect((await runOne.findAll({ type: 'Text' })).map(t => [t.text, t.props.dimColor])).toEqual(
        [[expect.stringMatching(/^Claude · \d\d:\d\d$/), undefined]],
      )
      await runOne.press({ key: 'toggle' })
      expect((await runOne.find({ key: 'toggle' }))?.text).toBe('▾ 2 steps')
      expect((await runOne.findAll({ type: 'Text' })).map(t => t.text)).toEqual([
        '✓ Read a.ts',
        '✓ Read b.ts',
        expect.stringMatching(/^Claude · /),
      ])
      await runOne.press({ key: 'toggle' })

      // Run 2: the failing command and the edit; one plain error line.
      const runTwo = await mount(steps[2]!, 'Bash')
      expect((await runTwo.find({ key: 'toggle' }))?.text).toBe('▸ 2 steps · 1 failed')
      expect((await runTwo.findAll({ type: 'Text' })).map(t => t.text)).toEqual([
        '  ✗ The command failed (exit 1). Press Ctrl+O to see its output.',
        expect.stringMatching(/^Opus 5\.5 · \d\d:\d\d$/),
      ])
      expect(await runTwo.find({ text: /npm ERR|\/Users|exit 0|lines/ })).toBeUndefined()

      // Every other row of a run draws nothing.
      const folded = await mount(steps[1]!, 'Read')
      expect(await folded.find({ key: 'folded' })).toBeDefined()
      expect(await folded.find({ type: 'Text' })).toBeUndefined()
      for (const ui of [runOne, runTwo, folded]) await ui.unmount()
    }
  })

  test('normal is the default view', async ($, on) => {
    const steps = await playTurn($, engineBottom(on))
    const ui = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: steps[0]!,
      props: toolRow(steps[0]!, 'Read', {}),
    })
    expect((await ui.find({ key: 'line' }))?.text).toBe('• Read 2 files')
  })

  test("normal lists each run's steps with one fact each", async ($, on) => {
    const steps = await playTurn($, engineBottom(on))
    await $.command.run({ command: 'lens', args: 'normal' } as never)
    const runOne = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: steps[0]!,
      props: toolRow(steps[0]!, 'Read', {}),
    })
    expect((await runOne.find({ key: 'line' }))?.text).toBe('• Read 2 files')
    expect(await runOne.find({ key: 'toggle' })).toBeUndefined()
    expect((await runOne.findAll({ type: 'Text' })).map(t => t.text)).toEqual([
      '• Read 2 files',
      '✓ Read a.ts · 12 lines',
      '✓ Read b.ts · 12 lines',
      expect.stringMatching(/^Claude · /),
    ])
    const runTwo = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: steps[2]!,
      props: toolRow(steps[2]!, 'Bash', {}),
    })
    expect((await runTwo.find({ key: 'line' }))?.text).toBe(
      '• Changed 1 file, ran 1 command (1 failed)',
    )
    expect((await runTwo.findAll({ type: 'Text' })).map(t => t.text)).toEqual([
      '• Changed 1 file, ran 1 command (1 failed)',
      '  The command failed (exit 1). Press Ctrl+O to see its output.',
      '  npm ERR! Missing script: "tset"',
      expect.stringMatching(/^Opus 5\.5 · \d\d:\d\d$/),
    ])
    // The failed command and the edit open their output and diff on click.
    expect((await runTwo.find({ key: `step-${steps[2]!}` }))?.text).toBe('✗ Run the tests · exit 1')
    expect((await runTwo.find({ key: `step-${steps[3]!}` }))?.text).toBe(
      '✓ Edited a.ts · +1 −1 lines',
    )
  })

  test('both views show the model a sub-agent ran', async ($, on) => {
    const bottom = engineBottom(on)
    await $.command.run({ command: 'lens', args: 'normal' } as never)
    await $.turn.start({ text: 'delegate', turnId: 'turn-8' })
    await $.tool.call({ tool: 'Agent', description: 'Count lines', prompt: 'count' })
    const ui = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: bottom.ids[0]!,
      props: toolRow(bottom.ids[0]!, 'Agent', {}),
    })
    expect((await ui.findAll({ type: 'Text' }))[1]?.text).toBe(
      '✓ Delegated: Count lines · Haiku 5.5 · 6s',
    )
    await ui.unmount()

    // Clean shows the sub-agent's model too, and nothing else.
    await $.command.run({ command: 'lens', args: 'clean' } as never)
    const lean = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: bottom.ids[0]!,
      props: toolRow(bottom.ids[0]!, 'Agent', {}),
    })
    await lean.press({ key: 'toggle' })
    expect((await lean.findAll({ type: 'Text' }))[0]?.text).toBe(
      '✓ Delegated: Count lines · Haiku 5.5',
    )

    // Its "finished" row carries the model and finish time, gray.
    const notice = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'UserMessage',
      requestId: 'n-1',
      props: {
        text: 'Agent "Count lines" finished',
        origin: { kind: 'task-notification' },
        isExpanded: false,
        task: { id: 'helper-1', toolUseId: bottom.ids[0]!, durationMs: 6200 },
      },
    })
    const label = await notice.find({ key: 'label' })
    expect(label?.text).toMatch(/^Haiku 5\.5 · \d\d:\d\d$/)
    expect((label?.children[0] as { props: Record<string, unknown> }).props).toEqual({
      color: 'inactive',
    })
  })

  test('clicking a step shows its diff or output in place', async ($, on) => {
    const steps = await playTurn($, engineBottom(on))
    await $.command.run({ command: 'lens', args: 'normal' } as never)
    const ui = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: steps[2]!,
      props: toolRow(steps[2]!, 'Bash', {}),
    })
    const edit = `step-${steps[3]!}`
    expect((await ui.find({ key: edit }))?.text).toBe('✓ Edited a.ts · +1 −1 lines')
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.press({ key: edit })
    const code = await ui.find({ type: 'Code' })
    expect(code?.props).toMatchObject({ format: 'diff', source: '@@ -1,1 +1,1 @@\n-x\n+y' })
    await ui.press({ key: edit })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    // A failed command opens its command, then its error output.
    await ui.press({ key: `step-${steps[2]!}` })
    expect((await ui.findAll({ type: 'Code' })).map(c => c.props)).toEqual([
      { source: '$ npm run tset -- --fail', language: 'bash' },
      { source: 'Exit code 1\nnpm ERR! Missing script: "tset"' },
    ])
  })

  test('a command opens to show what ran and its full output', async ($, on) => {
    const bottom = engineBottom(on)
    await $.turn.start({ text: 'run', turnId: 'turn-6' })
    await $.tool.call({ tool: 'Bash', command: 'echo hello', description: 'Say hello' })
    await $.tool.call({ tool: 'Bash', command: 'true # quiet', description: 'Do nothing' })
    for (const view of ['clean', 'normal'] as const) {
      await $.command.run({ command: 'lens', args: view } as never)
      const ui = await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'ToolUse',
        requestId: bottom.ids[0]!,
        props: toolRow(bottom.ids[0]!, 'Bash', {}),
      })
      if (view === 'clean') await ui.press({ key: 'toggle' })
      // The command sits in its own bordered box, the full output under it.
      await ui.press({ key: `step-${bottom.ids[0]!}` })
      expect(
        (await ui.findAll({ type: 'Code' })).map(c => c.props),
        view,
      ).toEqual([{ source: '$ echo hello', language: 'bash' }, { source: 'hello' }])
      const box = (await ui.findAll({ type: 'Box' })).find(b => b.props.borderStyle === 'round')
      expect(box?.text, view).toBe('$ echo hello')
      await ui.press({ key: `step-${bottom.ids[0]!}` })
      // A command that printed nothing still opens, to show what ran.
      await ui.press({ key: `step-${bottom.ids[1]!}` })
      expect(await ui.find({ type: 'Text', text: '(no output)' }), view).toBeDefined()
      await ui.press({ key: `step-${bottom.ids[1]!}` })
      await ui.unmount()
    }
  })

  test('normal caps a run at 5 steps until opened', async ($, on) => {
    const bottom = engineBottom(on)
    await $.command.run({ command: 'lens', args: 'normal' } as never)
    await $.turn.start({ text: 'read a lot', turnId: 'turn-7' })
    for (let n = 1; n <= 7; n += 1) await $.tool.call({ tool: 'Read', file_path: `/p/f${n}.ts` })
    const ui = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: bottom.ids[0]!,
      props: toolRow(bottom.ids[0]!, 'Read', {}),
    })
    const texts = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect((await texts()).slice(0, -1)).toEqual(
      [1, 2, 3, 4, 5].map(n => `✓ Read f${n}.ts · 12 lines`),
    )
    // `+2 more` opens the run in place; `show fewer` closes it again.
    expect((await ui.find({ key: 'more-toggle' }))?.text).toBe('+2 more')
    await ui.press({ key: 'more-toggle' })
    expect(await texts()).toHaveLength(8)
    expect(await ui.find({ key: 'more-toggle' })).toBeUndefined()
    await ui.press({ key: 'fewer-toggle' })
    expect(await texts()).toHaveLength(6)
    await ui.press({ key: 'toggle' })
    expect(await texts()).toHaveLength(8)
  })

  test('text blocks get a coloured label; runs a gray one under their steps', async ($, on) => {
    const seen: Array<{ text: string; isFirstOfReply: boolean }> = []
    let group: { isExpanded: boolean } | undefined
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      seen.push({ text: e.props.text, isFirstOfReply: e.props.isFirstOfReply })
      const { Text } = $.ui.resolve(e)
      return <Text>ENGINE</Text>
    })
    on('ui.render', { component: 'ToolGroup' }, ($, e) => {
      group = { isExpanded: e.props.isExpanded }
      const { Text } = $.ui.resolve(e)
      return <Text>ENGINE</Text>
    })
    const steps = await playTurn($, engineBottom(on))

    // The block keeps its own label, coloured, and loses the bullet.
    const block = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'AssistantMessage',
      requestId: 'reply-1',
      props: { text: 'Running the tests now.', isFirstOfReply: true },
    })
    const blockLabel = (await block.findAll({ type: 'Text' }))[1]
    expect(blockLabel?.text).toMatch(/^Opus 5\.5 · \d\d:\d\d$/)
    expect(blockLabel?.props).toMatchObject({ bold: true, color: 'claude' })
    expect(seen.at(-1)).toEqual({ text: 'Running the tests now.', isFirstOfReply: false })

    // The run after it: gray label, last, right-aligned, its model.
    const runTwo = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: steps[2]!,
      props: toolRow(steps[2]!, 'Bash', {}),
    })
    const fold = await runTwo.drawn()
    // Full width, so the label lines up with the message labels on the right.
    expect(fold).toMatchObject({ type: 'Box', props: { key: 'fold', width: '100%' } })
    const children = (
      fold as {
        children: Array<{ type: string; props: Record<string, unknown>; children: unknown[] }>
      }
    ).children
    expect(children.at(-1)).toMatchObject({
      type: 'Box',
      props: { key: 'label', justifyContent: 'flex-end' },
    })
    const runLabel = await runTwo.find({ key: 'label' })
    expect((runLabel?.children[0] as { props: Record<string, unknown> }).props).toEqual({
      color: 'inactive',
    })

    await $.command.run({ command: 'lens', args: 'clean' } as never)
    // A group Claude Code bundled draws the run's fold in its place, in
    // either state of the engine's own click toggle.
    const call = (id: string, tool: string) => ({
      tool_use_id: id,
      tool,
      input: {},
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    })
    for (const isExpanded of [false, true]) {
      const g = await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'ToolGroup',
        viewport: { columns: 120, rows: 40, isFullscreen: true },
        props: {
          calls: [call(steps[2]!, 'Bash'), call(steps[3]!, 'Edit')],
          isActive: false,
          isExpanded,
        },
      })
      expect((await g.find({ key: 'toggle' }))?.text).toBe('▸ 2 steps · 1 failed')
      expect(await g.find({ key: 'label' })).toBeDefined()
      await g.unmount()
    }
    expect(group).toBeUndefined()

    // A group of steps the mod never saw unfolds into plain rows.
    await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolGroup',
      props: { calls: [call('unseen', 'Read')], isActive: false, isExpanded: false },
    })
    expect(group).toEqual({ isExpanded: true })
  })

  test('raw restores the engine drawing everywhere', async ($, on) => {
    const steps = await playTurn($, engineBottom(on))
    await $.command.run({ command: 'lens', args: 'raw' } as never)
    const sites = [
      { component: 'ToolUse', props: toolRow(steps[0]!, 'Read', {}) },
      {
        component: 'ToolResult',
        props: { tool_use_id: steps[0]!, tool: 'Read', output: {}, isErrored: false },
      },
      { component: 'AssistantMessage', props: { text: 'Hi', isFirstOfReply: true } },
      {
        component: 'UserMessage',
        props: { text: 'fix it', origin: { kind: 'composer' }, isExpanded: false },
      },
      {
        component: 'Spinner',
        props: { word: 'Baking', message: null, suffix: '…', mode: 'tool-use' },
      },
      {
        component: 'CommandOutput',
        props: { command: 'x', args: '', text: 'ENOENT', isErrored: true },
      },
    ] as const
    for (const site of sites) {
      const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', ...site } as never)
      const drawn = await ui.drawn()
      expect(drawn, site.component).toMatchObject({ type: 'Text', children: ['ENGINE'] })
      await ui.unmount()
    }
    // And back: clean draws its own again.
    await $.command.run({ command: 'lens', args: 'clean' } as never)
    const back = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: steps[0]!,
      props: toolRow(steps[0]!, 'Read', {}),
    })
    expect(await back.find({ key: 'toggle' })).toBeDefined()
  })

  test('messages carry a label; answered questions fold to one line', async ($, on) => {
    const bottom = { lastText: '' }
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      bottom.lastText = e.props.text
      const { Text } = $.ui.resolve(e)
      return <Text>ENGINE</Text>
    })
    engineBottom(on)
    await $.session.append({
      door: 'prompt',
      uuid: 'u-1',
      origin: { kind: 'person' },
      message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'fix it' }] },
    } as never)
    const user = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'UserMessage',
      requestId: 'u-1',
      props: { text: 'fix it', origin: { kind: 'composer' }, isExpanded: false },
    })
    expect((await user.findAll({ type: 'Text' })).map(t => t.text)).toEqual([
      'ENGINE',
      expect.stringMatching(/^You · \d\d:\d\d$/),
    ])
    expect(await user.find({ text: 'ENGINE' })).toBeDefined()

    // Each reply is labeled with the model that sent it, inside its own text.
    for (const [uuid, model, text] of [
      ['r-1', 'claude-opus-5-5', 'First answer.'],
      ['r-2', 'claude-fable-5-1', 'Second answer.'],
    ] as const) {
      await $.session.append({
        door: 'response',
        uuid,
        origin: { kind: 'model', model },
        message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
      } as never)
    }
    const labels: Array<string | undefined> = []
    for (const [requestId, text] of [
      ['r-1', 'First answer.'],
      ['r-2', 'Second answer.'],
      ['r-x', 'Unseen.'],
    ] as const) {
      const reply = await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'AssistantMessage',
        requestId,
        props: { text, isFirstOfReply: true },
      })
      // The engine's drawing first, the label under it; the text untouched.
      const drawn = await reply.drawn()
      expect(drawn).toMatchObject({
        type: 'Box',
        children: [
          { type: 'Text', children: ['ENGINE'] },
          { type: 'Box', props: { justifyContent: 'flex-end' } },
        ],
      })
      expect(bottom.lastText).toBe(text)
      labels.push((await reply.findAll({ type: 'Text' }))[1]?.text)
      await reply.unmount()
    }
    expect(labels[0]).toMatch(/^Opus 5\.5 · \d\d:\d\d$/)
    expect(labels[1]).toMatch(/^Fable 5\.1 · \d\d:\d\d$/)
    expect(labels[2]).toBe('Claude')
    await user.unmount()

    // Ctrl+O: an expanded user row passes through untouched.
    const full = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'UserMessage',
      requestId: 'u-1',
      props: { text: 'fix it', origin: { kind: 'composer' }, isExpanded: true },
    })
    expect(await full.drawn()).toMatchObject({ type: 'Text', children: ['ENGINE'] })
    // While that view is open, tool rows pass through too.
    const inTranscript = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: 't-x',
      props: toolRow('t-x', 'Read', {}),
    })
    expect(await inTranscript.drawn()).toMatchObject({ type: 'Text', children: ['ENGINE'] })
    await full.unmount()
    // Back in the chat, a compact user row closes that window.
    await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'UserMessage',
      requestId: 'u-1',
      props: { text: 'fix it', origin: { kind: 'composer' }, isExpanded: false },
    })

    const question = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: 'q-1',
      props: {
        ...toolRow('q-1', 'AskUserQuestion', {}),
        output: {
          questions: [{ header: 'Scope', question: 'Which scope?' }],
          answers: { 'Which scope?': 'User' },
        },
      },
    })
    expect((await question.find({ key: 'question-toggle' }))?.text).toBe('? Answered Scope: User')
    // A click shows the question and the answer in full.
    await question.press({ key: 'question-toggle' })
    expect((await question.findAll({ type: 'Text' })).map(t => t.text)).toEqual([
      'Scope: Which scope?',
      '→ User',
    ])
    await question.press({ key: 'question-toggle' })
    expect(await question.findAll({ type: 'Text' })).toHaveLength(0)
  })

  test('the spinner shows the current step; command errors are relabeled', async ($, on) => {
    let seen: string | null = null
    let text = ''
    on('ui.render', { component: 'Spinner' }, ($, e) => {
      seen = e.props.message
      const { Text } = $.ui.resolve(e)
      return <Text>ENGINE</Text>
    })
    on('ui.render', { component: 'CommandOutput' }, ($, e) => {
      text = e.props.text
      const { Text } = $.ui.resolve(e)
      return <Text>ENGINE</Text>
    })
    const bottom = engineBottom(on)
    bottom.whileRunning = async () => {
      const ui = await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'Spinner',
        props: { word: 'Baking', message: null, suffix: '…', mode: 'tool-use' },
      })
      await ui.unmount()
    }
    await $.turn.start({ text: 'go', turnId: 'turn-9' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })
    expect(seen).toBe('Run the tests')

    await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'CommandOutput',
      props: {
        command: 'x',
        args: '',
        text: 'Error: EACCES: permission denied, open /etc/x',
        isErrored: true,
      },
    })
    expect(text).toBe('Permission denied. Check file permissions or run with access.')
  })
})
