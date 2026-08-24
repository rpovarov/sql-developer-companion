import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { findEmbeddedSqlRanges } from '../embeddedSql/embeddedSqlRanges';
import { resolveEmbeddedSqlReferenceAt } from '../plsqlNavigation/embeddedSqlNavigation';
import {
    extractProgramUnitSymbols,
    ProgramUnitSymbol,
    resolveObjectMethodCall,
} from '../plsqlNavigation/semanticNavigation';

const repositoryRoot = path.resolve(__dirname, '../../..');

function example(name: string): string {
    return readFileSync(path.join(repositoryRoot, 'examples', name), 'utf8');
}

const documents = [
    'demo_item_type.tps',
    'demo_item_type.tpb',
    'demo_special_item.sql',
    'demo_repository_api.pks',
    'demo_repository_api.pkb',
].map(name => ({
    uri: `file:///examples/${name}`,
    text: example(name),
}));
const allSymbols = documents.flatMap(extractProgramUnitSymbols);
const lookup = (name: string): ProgramUnitSymbol[] => allSymbols.filter(symbol =>
    symbol.name.toLowerCase() === name.toLowerCase()
);

function resolveMethod(documentName: string, call: string) {
    const document = documents.find(candidate => candidate.uri.endsWith(documentName));
    assert.ok(document);
    const offset = document.text.indexOf(call);
    assert.notEqual(offset, -1);
    const before = document.text.slice(0, offset);
    const line = (before.match(/\n/g) ?? []).length;
    const column = offset - before.lastIndexOf('\n') - 1;
    const methodName = call.split(/[.(]/).filter(Boolean).at(-1) ?? call;
    return resolveObjectMethodCall(
        document,
        line,
        column + call.indexOf(methodName) + 1,
        extractProgramUnitSymbols(document),
        lookup,
    );
}

test('examples contain the requested repository file forms and counterparts', () => {
    assert.deepEqual(
        documents.map(document => path.extname(document.uri)).sort(),
        ['.pkb', '.pks', '.sql', '.tpb', '.tps'],
    );
    assert.deepEqual(
        lookup('demo_repository_api')
            .filter(symbol => symbol.kind === 'package')
            .map(symbol => symbol.side),
        ['specification', 'body'],
    );
    assert.deepEqual(
        lookup('demo_item_type')
            .filter(symbol => symbol.kind === 'type')
            .map(symbol => symbol.side),
        ['specification', 'body'],
    );
    assert.deepEqual(
        lookup('demo_special_item_type')
            .filter(symbol => symbol.kind === 'type')
            .map(symbol => symbol.side),
        ['specification', 'body'],
    );
});

test('example object calls cover overloads, collection elements, and inheritance', () => {
    assert.deepEqual(
        resolveMethod('demo_repository_api.pkb', 'l_item.score')
            .map(symbol => symbol.parameterNames),
        [['p_value'], ['p_value']],
    );
    assert.deepEqual(
        resolveMethod('demo_repository_api.pkb', 'l_items(1).score')
            .map(symbol => symbol.parameterNames),
        [['p_text'], ['p_text']],
    );
    assert.deepEqual(
        resolveMethod('demo_special_item.sql', 'SELF.display_name')
            .map(symbol => symbol.programUnitName),
        ['demo_item_type', 'demo_item_type'],
    );
});

test('Python example covers all injection forms and navigates to local PL/SQL', () => {
    const python = example('embedded_sql_examples.py');
    assert.equal(findEmbeddedSqlRanges(python).length, 17);

    const packageCall = resolveEmbeddedSqlReferenceAt(
        python,
        python.indexOf('reserve_item') + 2,
        lookup,
        'definition',
        'both',
    );
    assert.deepEqual(packageCall?.targets.map(symbol => ({
        uri: symbol.uri,
        parameters: symbol.parameterNames,
    })), [
        {
            uri: 'file:///examples/demo_repository_api.pks',
            parameters: ['p_item_code', 'p_priority'],
        },
        {
            uri: 'file:///examples/demo_repository_api.pkb',
            parameters: ['p_item_code', 'p_priority'],
        },
    ]);

    const staticCall = resolveEmbeddedSqlReferenceAt(
        python,
        python.indexOf('from_json') + 2,
        lookup,
        'definition',
        'both',
    );
    assert.deepEqual(staticCall?.targets.map(symbol => symbol.uri), [
        'file:///examples/demo_item_type.tps',
        'file:///examples/demo_item_type.tpb',
    ]);

    const dynamicCallOffset = python.lastIndexOf('reserve_item') + 2;
    assert.equal(
        resolveEmbeddedSqlReferenceAt(
            python,
            dynamicCallOffset,
            lookup,
            'definition',
            'both',
        ),
        undefined,
    );
});
