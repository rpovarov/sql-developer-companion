import assert from 'node:assert/strict';
import test from 'node:test';
import {
    extractProgramUnitSymbols,
    findCounterparts,
    findNavigationTargets,
    findSymbolAt
} from './semanticNavigation';

test('package specification header finds its body in another document', () => {
    const specification = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pks',
        text: 'CREATE OR REPLACE PACKAGE order_api AS\nEND order_api;\n/'
    });
    const body = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pkb',
        text: 'CREATE OR REPLACE PACKAGE BODY order_api AS\nEND order_api;\n/'
    });

    const counterparts = findCounterparts(specification[0], body);

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

test('object type specification header finds its body in the same document', () => {
    const symbols = extractProgramUnitSymbols({
        uri: 'file:///workspace/shipping_address.sql',
        text: [
            'CREATE TYPE shipping_address AS OBJECT (',
            '    street VARCHAR2(100)',
            ');',
            '/',
            'CREATE TYPE BODY shipping_address AS',
            'END shipping_address;',
            '/'
        ].join('\n')
    });

    assert.deepEqual(symbols.map(symbol => ({
        name: symbol.name,
        kind: symbol.kind,
        side: symbol.side,
        line: symbol.line,
        column: symbol.column
    })), [
        { name: 'shipping_address', kind: 'type', side: 'specification', line: 0, column: 12 },
        { name: 'shipping_address', kind: 'type', side: 'body', line: 4, column: 17 }
    ]);
    assert.equal(findCounterparts(symbols[0], symbols)[0], symbols[1]);
});

test('object type headers navigate between separate repository documents', () => {
    const specification = extractProgramUnitSymbols({
        uri: 'file:///workspace/shipping_address_spec.sql',
        text: 'CREATE TYPE shipping_address AS OBJECT (street VARCHAR2(100));\n/'
    });
    const body = extractProgramUnitSymbols({
        uri: 'file:///workspace/shipping_address_body.sql',
        text: 'CREATE TYPE BODY shipping_address AS\nEND shipping_address;\n/'
    });

    assert.equal(findNavigationTargets(specification[0], body, 'implementation')[0], body[0]);
    assert.equal(findNavigationTargets(body[0], specification, 'declaration')[0], specification[0]);
});

test('object subtype specification exposes its header and overriding member', () => {
    const symbols = extractProgramUnitSymbols({
        uri: 'file:///workspace/express_parcel.sql',
        text: [
            'CREATE TYPE express_parcel UNDER parcel (',
            '    OVERRIDING MEMBER PROCEDURE render',
            ');',
            '/'
        ].join('\n')
    });

    assert.deepEqual(symbols.map(symbol => ({
        programUnitName: symbol.programUnitName,
        name: symbol.name,
        kind: symbol.kind,
        modifiers: symbol.modifiers
    })), [
        { programUnitName: 'express_parcel', name: 'express_parcel', kind: 'type', modifiers: [] },
        { programUnitName: 'express_parcel', name: 'render', kind: 'procedure', modifiers: ['overriding', 'member'] }
    ]);
});

test('FORCE object type specification pairs with its body', () => {
    const symbols = extractProgramUnitSymbols({
        uri: 'file:///workspace/t_demo.sql',
        text: [
            'CREATE TYPE t_demo FORCE AS OBJECT (',
            '    MEMBER FUNCTION value RETURN NUMBER',
            ');',
            '/',
            'CREATE TYPE BODY t_demo AS',
            '    MEMBER FUNCTION value RETURN NUMBER IS BEGIN RETURN 1; END;',
            'END t_demo;',
            '/'
        ].join('\n')
    });
    const specification = symbols.find(symbol =>
        symbol.kind === 'type' && symbol.side === 'specification'
    );
    const body = symbols.find(symbol =>
        symbol.kind === 'type' && symbol.side === 'body'
    );

    assert.ok(specification);
    assert.ok(body);
    assert.equal(findCounterparts(specification, symbols)[0], body);
});

test('overloaded constructors pair by normalized parameter signature', () => {
    const symbols = extractProgramUnitSymbols({
        uri: 'file:///workspace/parcel.sql',
        text: [
            'CREATE TYPE parcel AS OBJECT (',
            '    CONSTRUCTOR FUNCTION parcel(p_id NUMBER) RETURN SELF AS RESULT,',
            '    CONSTRUCTOR FUNCTION parcel(p_code VARCHAR2) RETURN SELF AS RESULT',
            ');',
            '/',
            'CREATE TYPE BODY parcel AS',
            '    CONSTRUCTOR FUNCTION parcel(p_code IN varchar2) RETURN SELF AS RESULT IS',
            '    BEGIN',
            '        RETURN;',
            '    END;',
            '    CONSTRUCTOR FUNCTION parcel(p_id IN number) RETURN SELF AS RESULT IS',
            '    BEGIN',
            '        RETURN;',
            '    END;',
            'END parcel;',
            '/'
        ].join('\n')
    });
    const constructors = symbols.filter(symbol => symbol.modifiers.includes('constructor'));
    const numberDeclaration = constructors.find(symbol =>
        symbol.side === 'specification' && symbol.signature === 'NUMBER'
    );

    assert.ok(numberDeclaration);
    assert.deepEqual(findCounterparts(numberDeclaration, constructors).map(symbol => ({
        side: symbol.side,
        line: symbol.line,
        signature: symbol.signature,
        modifiers: symbol.modifiers
    })), [{
        side: 'body',
        line: 10,
        signature: 'NUMBER',
        modifiers: ['constructor']
    }]);
});

test('constructor named endings do not hide later overloads in the type body', () => {
    const symbols = extractProgramUnitSymbols({
        uri: 'file:///workspace/parcel.sql',
        text: [
            'CREATE TYPE parcel AS OBJECT (',
            '    CONSTRUCTOR FUNCTION parcel(p_id NUMBER) RETURN SELF AS RESULT,',
            '    CONSTRUCTOR FUNCTION parcel(p_code VARCHAR2) RETURN SELF AS RESULT',
            ');',
            '/',
            'CREATE TYPE BODY parcel AS',
            '    CONSTRUCTOR FUNCTION parcel(p_code VARCHAR2) RETURN SELF AS RESULT IS BEGIN RETURN; END parcel;',
            '    CONSTRUCTOR FUNCTION parcel(p_id NUMBER) RETURN SELF AS RESULT IS BEGIN RETURN; END parcel;',
            'END parcel;',
            '/'
        ].join('\n')
    });

    assert.deepEqual(symbols
        .filter(symbol => symbol.side === 'body' && symbol.modifiers.includes('constructor'))
        .map(symbol => ({ line: symbol.line, signature: symbol.signature })), [
        { line: 6, signature: 'VARCHAR2' },
        { line: 7, signature: 'NUMBER' }
    ]);
});

test('constructor declaration finds its implementation in a separate file', () => {
    const specification = extractProgramUnitSymbols({
        uri: 'file:///workspace/parcel_spec.sql',
        text: [
            'CREATE TYPE parcel AS OBJECT (',
            '    CONSTRUCTOR FUNCTION parcel(p_id NUMBER) RETURN SELF AS RESULT,',
            '    CONSTRUCTOR FUNCTION parcel(p_code VARCHAR2) RETURN SELF AS RESULT',
            ');',
            '/'
        ].join('\n')
    });
    const body = extractProgramUnitSymbols({
        uri: 'file:///workspace/parcel_body.sql',
        text: [
            'CREATE TYPE BODY parcel AS',
            '    CONSTRUCTOR FUNCTION parcel(p_code VARCHAR2) RETURN SELF AS RESULT IS BEGIN RETURN; END parcel;',
            '    CONSTRUCTOR FUNCTION parcel(p_id IN NUMBER) RETURN SELF AS RESULT IS BEGIN RETURN; END parcel;',
            'END parcel;',
            '/'
        ].join('\n')
    });
    const numberDeclaration = specification.find(symbol =>
        symbol.modifiers.includes('constructor') && symbol.signature === 'NUMBER'
    );

    assert.ok(numberDeclaration);
    assert.deepEqual(findCounterparts(numberDeclaration, body).map(symbol => ({
        uri: symbol.uri,
        line: symbol.line,
        signature: symbol.signature
    })), [{
        uri: 'file:///workspace/parcel_body.sql',
        line: 2,
        signature: 'NUMBER'
    }]);
});

test('object type direct method modifiers use the shared member model', () => {
    const symbols = extractProgramUnitSymbols({
        uri: 'file:///workspace/parcel.sql',
        text: [
            'CREATE TYPE parcel AS OBJECT (',
            '    MEMBER PROCEDURE rename(p_name VARCHAR2),',
            '    STATIC FUNCTION empty_parcel RETURN parcel,',
            '    MAP MEMBER FUNCTION sort_key RETURN NUMBER,',
            '    ORDER MEMBER FUNCTION compare(p_other parcel) RETURN INTEGER,',
            '    OVERRIDING MEMBER PROCEDURE render',
            ');',
            '/',
            'CREATE TYPE BODY parcel AS',
            '    MEMBER PROCEDURE rename(p_name VARCHAR2) IS BEGIN NULL; END;',
            '    STATIC FUNCTION empty_parcel RETURN parcel IS BEGIN RETURN NULL; END;',
            '    MAP MEMBER FUNCTION sort_key RETURN NUMBER IS BEGIN RETURN 0; END;',
            '    ORDER MEMBER FUNCTION compare(p_other parcel) RETURN INTEGER IS BEGIN RETURN 0; END;',
            '    OVERRIDING MEMBER PROCEDURE render IS BEGIN NULL; END;',
            'END parcel;',
            '/'
        ].join('\n')
    });
    const declarations = symbols.filter(symbol =>
        symbol.side === 'specification' && symbol.kind !== 'type'
    );

    assert.deepEqual(declarations.map(symbol => ({
        name: symbol.name,
        kind: symbol.kind,
        modifiers: symbol.modifiers
    })), [
        { name: 'rename', kind: 'procedure', modifiers: ['member'] },
        { name: 'empty_parcel', kind: 'function', modifiers: ['static'] },
        { name: 'sort_key', kind: 'function', modifiers: ['map', 'member'] },
        { name: 'compare', kind: 'function', modifiers: ['order', 'member'] },
        { name: 'render', kind: 'procedure', modifiers: ['overriding', 'member'] }
    ]);
    assert.deepEqual(declarations.map(declaration =>
        findCounterparts(declaration, symbols).map(symbol => symbol.line)
    ), [[9], [10], [11], [12], [13]]);
});

test('package-local collection type is not treated as an object type program unit', () => {
    const symbols = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pks',
        text: [
            'CREATE PACKAGE order_api AS',
            '    TYPE order_ids IS TABLE OF NUMBER;',
            '    PROCEDURE submit_order;',
            'END order_api;',
            '/'
        ].join('\n')
    });

    assert.deepEqual(symbols.map(symbol => ({
        programUnitName: symbol.programUnitName,
        name: symbol.name,
        kind: symbol.kind
    })), [
        { programUnitName: 'order_api', name: 'order_api', kind: 'package' },
        { programUnitName: 'order_api', name: 'submit_order', kind: 'procedure' }
    ]);
});

test('direct package member declaration finds its implementation', () => {
    const specification = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pks',
        text: [
            'CREATE OR REPLACE PACKAGE order_api AS',
            '    PROCEDURE submit_order(p_order_id NUMBER);',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const body = extractProgramUnitSymbols({
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
    assert.deepEqual(findCounterparts(member, body).map(symbol => ({
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
    const symbols = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pks',
        text: [
            'CREATE PACKAGE order_api AS',
            '    FUNCTION order_total RETURN NUMBER;',
            'END order_api;'
        ].join('\n')
    });

    assert.equal(findSymbolAt(symbols, 1, 17)?.name, 'order_total');
    assert.equal(findSymbolAt(symbols, 1, 4), undefined);
});

test('navigation directions pair package sides in the same document', () => {
    const symbols = extractProgramUnitSymbols({
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
    assert.equal(findNavigationTargets(declaration, symbols, 'definition')[0], implementation);
    assert.equal(findNavigationTargets(implementation, symbols, 'definition')[0], declaration);
    assert.equal(findNavigationTargets(implementation, symbols, 'declaration')[0], declaration);
    assert.deepEqual(findNavigationTargets(declaration, symbols, 'declaration'), []);
    assert.equal(findNavigationTargets(declaration, symbols, 'implementation')[0], implementation);
    assert.deepEqual(findNavigationTargets(implementation, symbols, 'implementation'), []);
});

test('unnamed package terminator keeps same-file specification and body separate', () => {
    const symbols = extractProgramUnitSymbols({
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
    const symbols = extractProgramUnitSymbols({
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
    assert.equal(findCounterparts(declaration, symbols).length, 1);
});

test('unnamed member endings still exclude nested subprograms and keep following direct members', () => {
    const symbols = extractProgramUnitSymbols({
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
