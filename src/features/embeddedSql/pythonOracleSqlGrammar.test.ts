import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

interface GrammarRule {
  contentName?: string;
  begin?: string;
  end?: string;
  match?: string;
  captures?: Record<string, { name: string }>;
  patterns?: Array<{ include?: string }>;
}

interface InjectionGrammar {
  scopeName: string;
  injectionSelector: string;
  repository: Record<string, GrammarRule>;
}

const repositoryRoot = path.resolve(__dirname, '../../..');

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(path.join(repositoryRoot, relativePath), 'utf8'),
  ) as T;
}

test('package registers the Python Oracle SQL injection grammar', () => {
  const manifest = readJson<{
    contributes: {
      grammars: Array<{
        scopeName: string;
        path: string;
        injectTo: string[];
        embeddedLanguages: Record<string, string>;
        tokenTypes: Record<string, string>;
      }>;
    };
  }>('package.json');

  assert.deepEqual(manifest.contributes.grammars, [
    {
      scopeName: 'sql-developer-companion.python-oracle-sql.injection',
      path: './syntaxes/python-oracle-sql.injection.json',
      injectTo: ['source.python'],
      embeddedLanguages: {
        'meta.embedded.block.oracle-sql': 'oracle-sql',
        'meta.embedded.inline.oracle-sql': 'oracle-sql',
      },
      tokenTypes: {
        'meta.embedded.block.oracle-sql': 'other',
        'meta.embedded.inline.oracle-sql': 'other',
      },
    },
  ]);
});

test('package registers the optional theme-aware injection background', () => {
  const manifest = readJson<{
    activationEvents: string[];
    contributes: {
      colors: Array<{
        id: string;
        defaults: Record<string, string>;
      }>;
      configuration: {
        properties: Record<string, { type: string; default: unknown }>;
      };
    };
  }>('package.json');

  assert.ok(manifest.activationEvents.includes('onLanguage:python'));
  assert.deepEqual(manifest.contributes.colors, [
    {
      id: 'sqlDevCompanion.embeddedSqlBackground',
      description: 'Background color for Oracle SQL embedded in Python strings.',
      defaults: {
        dark: '#7A9AA614',
        light: '#4A687314',
        highContrast: '#00000000',
        highContrastLight: '#00000000',
      },
    },
  ]);
  assert.deepEqual(
    manifest.contributes.configuration.properties[
      'sqlDevCompanion.embeddedSqlBackground'
    ],
    {
      type: 'boolean',
      default: true,
      description:
        'Show a subtle theme-aware background behind Oracle SQL embedded in Python strings.',
    },
  );
});

test('grammar embeds Oracle SQL only in the intended Python contexts', () => {
  const grammar = readJson<InjectionGrammar>(
    'syntaxes/python-oracle-sql.injection.json',
  );

  assert.equal(
    grammar.scopeName,
    'sql-developer-companion.python-oracle-sql.injection',
  );
  assert.equal(grammar.injectionSelector, 'L:source.python -comment -string');

  const assigned = grammar.repository['assigned-sql'];
  const executed = grammar.repository['executed-sql'];
  const executedNextLine = grammar.repository['executed-sql-next-line'];
  const executedNextLineString =
    grammar.repository['executed-sql-next-line-string'];
  const executedNextLineInlineString =
    grammar.repository['executed-sql-next-line-inline-string'];
  const executedNextLineFString =
    grammar.repository['executed-sql-next-line-f-string'];
  const parenthesized = grammar.repository['parenthesized-sql'];
  const parenthesizedString =
    grammar.repository['parenthesized-sql-string'];
  const assignedFString = grammar.repository['assigned-f-sql'];
  const fInterpolation = grammar.repository['python-f-interpolation'];
  const oracleSql = grammar.repository['oracle-sql'];
  const qualifiedCall = grammar.repository['oracle-qualified-call'];
  const namedArgument = grammar.repository['oracle-named-argument'];
  const bindVariable = grammar.repository['oracle-bind-variable'];

  assert.deepEqual(oracleSql.patterns, [
    { include: '#oracle-qualified-call' },
    { include: '#oracle-named-argument' },
    { include: '#oracle-bind-variable' },
    { include: 'source.oracle-sql' },
  ]);
  assert.match(qualifiedCall.match ?? '', /A-Z_/);
  assert.deepEqual(qualifiedCall.captures, {
    '1': { name: 'entity.name.namespace.oracle-sql' },
    '2': { name: 'punctuation.accessor.oracle-sql' },
    '3': { name: 'entity.name.function.oracle-sql' },
  });
  assert.match(namedArgument.match ?? '', /=>/);
  assert.deepEqual(namedArgument.captures, {
    '1': { name: 'variable.parameter.oracle-sql' },
    '3': { name: 'keyword.operator.assignment.oracle-sql' },
  });
  assert.match(bindVariable.match ?? '', /:/);
  assert.deepEqual(bindVariable.captures, {
    '1': { name: 'punctuation.definition.variable.oracle-sql' },
    '2': { name: 'variable.other.readwrite.oracle-sql' },
  });

  const textMateRegex = (pattern: string): RegExp =>
    new RegExp(pattern.replace(/^\(\?ix\)/, ''), 'i');
  assert.deepEqual(
    textMateRegex(qualifiedCall.match ?? '').exec(
      'pkg_target.reserve_profiled_or_get(',
    )?.slice(1),
    ['pkg_target', '.', 'reserve_profiled_or_get'],
  );
  assert.deepEqual(
    textMateRegex(namedArgument.match ?? '').exec(
      'p_migration_scope_key => :scope_key',
    )?.slice(1),
    ['p_migration_scope_key', ' ', '=>'],
  );
  assert.deepEqual(
    textMateRegex(bindVariable.match ?? '').exec(':scope_key')?.slice(1),
    [':', 'scope_key'],
  );

  for (const rule of [assigned, executed]) {
    assert.equal(rule.contentName, 'meta.embedded.block.oracle-sql');
    assert.deepEqual(rule.patterns, [{ include: '#oracle-sql' }]);
  }

  assert.match(assigned.begin ?? '', /sql\|query\|statement/);
  assert.match(executed.begin ?? '', /execute\|executemany/);
  assert.doesNotMatch(assigned.begin ?? '', /f/);
  assert.doesNotMatch(executed.begin ?? '', /f/);
  assert.equal(assigned.end, '\\3');
  assert.equal(executed.end, '\\2');
  assert.match(executedNextLine.begin ?? '', /execute\|executemany/);
  assert.deepEqual(executedNextLine.patterns, [
    { include: '#executed-sql-next-line-string' },
    { include: '#executed-sql-next-line-inline-string' },
    { include: '#executed-sql-next-line-f-string' },
    { include: 'source.python' },
  ]);
  assert.equal(
    executedNextLineString.contentName,
    'meta.embedded.block.oracle-sql',
  );
  assert.deepEqual(executedNextLineString.patterns, [
    { include: '#oracle-sql' },
  ]);
  assert.equal(
    executedNextLineInlineString.contentName,
    'meta.embedded.inline.oracle-sql',
  );
  assert.deepEqual(executedNextLineInlineString.patterns, [
    { include: '#python-string-escape' },
    { include: '#oracle-sql' },
  ]);
  assert.equal(
    executedNextLineFString.contentName,
    'meta.embedded.inline.oracle-sql',
  );
  assert.deepEqual(executedNextLineFString.patterns, [
    { include: '#python-f-interpolation' },
    { include: '#python-string-escape' },
    { include: '#oracle-sql' },
  ]);
  assert.match(parenthesized.begin ?? '', /sql\|query\|statement/);
  assert.deepEqual(parenthesized.patterns, [
    { include: '#parenthesized-sql-comment' },
    { include: '#parenthesized-sql-string' },
  ]);
  assert.equal(
    parenthesizedString.contentName,
    'meta.embedded.inline.oracle-sql',
  );
  assert.deepEqual(parenthesizedString.patterns, [
    { include: '#python-string-escape' },
    { include: '#oracle-sql' },
  ]);
  assert.equal(assignedFString.contentName, 'meta.embedded.block.oracle-sql');
  assert.match(assignedFString.begin ?? '', /fr\|rf\|f/);
  assert.deepEqual(assignedFString.patterns, [
    { include: '#python-f-interpolation' },
    { include: '#oracle-sql' },
  ]);
  assert.deepEqual(fInterpolation.patterns, [{ include: 'source.python' }]);

  // These patterns use only the shared JavaScript/Oniguruma regex subset;
  // remove the TextMate inline flags so representative contexts can be tested.
  const assignedBegin = new RegExp(
    (assigned.begin ?? '').replace(/^\(\?ix\)/, ''),
    'i',
  );
  const executedBegin = new RegExp(
    (executed.begin ?? '').replace(/^\(\?ix\)/, ''),
    'i',
  );

  for (const sample of [
    'query = """',
    "sql_text = r'''",
    'SELECT_STATEMENT = R"""',
    "stmt = u'''",
  ]) {
    assert.match(sample, assignedBegin);
  }
  assert.doesNotMatch('query = f"""', assignedBegin);
  assert.doesNotMatch('description = """', assignedBegin);

  assert.match('cursor.execute("""', executedBegin);
  assert.match("db_cursor.executemany(r'''", executedBegin);
  assert.doesNotMatch('cursor.execute(f"""', executedBegin);
});
