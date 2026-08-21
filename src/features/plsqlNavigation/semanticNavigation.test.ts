import assert from 'node:assert/strict';
import test from 'node:test';
import {
    extractPackageSymbols,
    findPackageCounterparts,
    findPackageNavigationTargets,
    findPackageSymbolAt
} from './semanticNavigation';

test('package specification header finds its body in another document', () => {
    const specification = extractPackageSymbols({
        uri: 'file:///workspace/order_api.pks',
        text: 'CREATE OR REPLACE PACKAGE order_api AS\nEND order_api;\n/'
    });
    const body = extractPackageSymbols({
        uri: 'file:///workspace/order_api.pkb',
        text: 'CREATE OR REPLACE PACKAGE BODY order_api AS\nEND order_api;\n/'
    });

    const counterparts = findPackageCounterparts(specification[0], body);

    assert.deepEqual(counterparts.map(symbol => ({
        uri: symbol.uri,
        side: symbol.side,
        line: symbol.line,
        column: symbol.column
    })), [{
        uri: 'file:///workspace/order_api.pkb',
        side: 'body',
        line: 0,
        column: 31
    }]);
});

test('direct package member declaration finds its implementation', () => {
    const specification = extractPackageSymbols({
        uri: 'file:///workspace/order_api.pks',
        text: [
            'CREATE OR REPLACE PACKAGE order_api AS',
            '    PROCEDURE submit_order(p_order_id NUMBER);',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const body = extractPackageSymbols({
        uri: 'file:///workspace/order_api.pkb',
        text: [
            'CREATE OR REPLACE PACKAGE BODY order_api AS',
            '    PROCEDURE submit_order(p_order_id NUMBER) IS',
            '    BEGIN',
            '        NULL;',
            '    END submit_order;',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const member = specification.find(symbol => symbol.kind === 'procedure');

    assert.ok(member);
    assert.deepEqual(findPackageCounterparts(member, body).map(symbol => ({
        uri: symbol.uri,
        side: symbol.side,
        kind: symbol.kind,
        name: symbol.name,
        line: symbol.line,
        column: symbol.column
    })), [{
        uri: 'file:///workspace/order_api.pkb',
        side: 'body',
        kind: 'procedure',
        name: 'submit_order',
        line: 1,
        column: 14
    }]);
});

test('symbol at cursor is found only while the cursor is on its name', () => {
    const symbols = extractPackageSymbols({
        uri: 'file:///workspace/order_api.pks',
        text: [
            'CREATE PACKAGE order_api AS',
            '    FUNCTION order_total RETURN NUMBER;',
            'END order_api;'
        ].join('\n')
    });

    assert.equal(findPackageSymbolAt(symbols, 1, 17)?.name, 'order_total');
    assert.equal(findPackageSymbolAt(symbols, 1, 4), undefined);
});

test('navigation directions pair package sides in the same document', () => {
    const symbols = extractPackageSymbols({
        uri: 'file:///workspace/order_api.sql',
        text: [
            'CREATE PACKAGE order_api AS',
            '    FUNCTION order_total RETURN NUMBER;',
            'END order_api;',
            '/',
            'CREATE PACKAGE BODY order_api AS',
            '    FUNCTION order_total RETURN NUMBER IS',
            '    BEGIN',
            '        RETURN 0;',
            '    END order_total;',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const declaration = symbols.find(symbol =>
        symbol.kind === 'function' && symbol.side === 'specification'
    );
    const implementation = symbols.find(symbol =>
        symbol.kind === 'function' && symbol.side === 'body'
    );

    assert.ok(declaration);
    assert.ok(implementation);
    assert.equal(findPackageNavigationTargets(declaration, symbols, 'definition')[0], implementation);
    assert.equal(findPackageNavigationTargets(implementation, symbols, 'definition')[0], declaration);
    assert.equal(findPackageNavigationTargets(implementation, symbols, 'declaration')[0], declaration);
    assert.deepEqual(findPackageNavigationTargets(declaration, symbols, 'declaration'), []);
    assert.equal(findPackageNavigationTargets(declaration, symbols, 'implementation')[0], implementation);
    assert.deepEqual(findPackageNavigationTargets(implementation, symbols, 'implementation'), []);
});

test('unnamed package terminator keeps same-file specification and body separate', () => {
    const symbols = extractPackageSymbols({
        uri: 'file:///workspace/order_api.sql',
        text: [
            'CREATE PACKAGE order_api AS',
            '    PROCEDURE submit_order;',
            'END;',
            '/',
            'CREATE PACKAGE BODY order_api AS',
            '    PROCEDURE submit_order IS',
            '    BEGIN',
            '        NULL;',
            '    END;',
            'END;',
            '/'
        ].join('\n')
    });

    assert.deepEqual(symbols
        .filter(symbol => symbol.kind === 'procedure')
        .map(symbol => ({ side: symbol.side, line: symbol.line })), [
        { side: 'specification', line: 1 },
        { side: 'body', line: 5 }
    ]);
});

test('nested subprogram is not exported as a direct package member', () => {
    const symbols = extractPackageSymbols({
        uri: 'file:///workspace/order_api.sql',
        text: [
            'CREATE PACKAGE order_api AS',
            '    PROCEDURE submit_order;',
            'END;',
            '/',
            'CREATE PACKAGE BODY order_api AS',
            '    PROCEDURE submit_order IS',
            '        PROCEDURE write_audit IS',
            '        BEGIN',
            '            NULL;',
            '        END write_audit;',
            '    BEGIN',
            '        write_audit;',
            '    END submit_order;',
            'END;',
            '/'
        ].join('\n')
    });
    const declaration = symbols.find(symbol =>
        symbol.kind === 'procedure' && symbol.side === 'specification'
    );

    assert.ok(declaration);
    assert.deepEqual(symbols
        .filter(symbol => symbol.kind === 'procedure')
        .map(symbol => ({ name: symbol.name, side: symbol.side })), [
        { name: 'submit_order', side: 'specification' },
        { name: 'submit_order', side: 'body' }
    ]);
    assert.equal(findPackageCounterparts(declaration, symbols).length, 1);
});

test('unnamed member endings still exclude nested subprograms and keep following direct members', () => {
    const symbols = extractPackageSymbols({
        uri: 'file:///workspace/order_api.pkb',
        text: [
            'CREATE PACKAGE BODY order_api AS',
            '    PROCEDURE submit_order IS',
            '        PROCEDURE write_audit IS',
            '        BEGIN',
            '            NULL;',
            '        END;',
            '    BEGIN',
            '        write_audit;',
            '    END;',
            '',
            '    FUNCTION order_total RETURN NUMBER IS',
            '    BEGIN',
            '        RETURN 0;',
            '    END;',
            'END;',
            '/'
        ].join('\n')
    });

    assert.deepEqual(symbols
        .filter(symbol => symbol.kind !== 'package')
        .map(symbol => ({ kind: symbol.kind, name: symbol.name })), [
        { kind: 'procedure', name: 'submit_order' },
        { kind: 'function', name: 'order_total' }
    ]);
});
