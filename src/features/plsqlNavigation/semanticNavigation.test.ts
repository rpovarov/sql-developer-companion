import assert from 'node:assert/strict';
import test from 'node:test';
import {
    extractProgramUnitSymbols,
    findCounterparts,
    findNavigationTargets,
    resolveObjectMethodCall,
    findSchemaTypeDefinitions,
    findSchemaTypeReferenceAt,
    findSymbolAt
} from './semanticNavigation';

function resolveMethodAt(
    document: { uri: string; text: string },
    line: number,
    methodName: string,
    allSymbols: ReturnType<typeof extractProgramUnitSymbols>
) {
    const currentSymbols = allSymbols.filter(symbol => symbol.uri === document.uri);
    const sourceLine = document.text.split('\n')[line];
    return resolveObjectMethodCall(
        document,
        line,
        sourceLine.indexOf(methodName) + 2,
        currentSymbols,
        name => allSymbols.filter(symbol =>
            symbol.name.toLowerCase() === name.toLowerCase()
        )
    );
}

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

test('schema collection specifications enter the program-unit index', () => {
    const symbols = extractProgramUnitSymbols({
        uri: 'file:///workspace/customer_types.tps',
        text: [
            'CREATE TYPE customer_ids AS TABLE OF NUMBER;',
            '/',
            'CREATE TYPE customer_codes AS VARRAY(20) OF VARCHAR2(30);',
            '/'
        ].join('\n')
    });

    assert.deepEqual(symbols.map(symbol => ({
        name: symbol.name,
        kind: symbol.kind,
        side: symbol.side
    })), [
        { name: 'customer_ids', kind: 'type', side: 'specification' },
        { name: 'customer_codes', kind: 'type', side: 'specification' }
    ]);
});

test('schema type references are recognized in supported type positions', () => {
    const lines = [
        'PROCEDURE load_customer(p_value IN OUT NOCOPY app.customer_type);',
        'v_customer customer_type;',
        'FUNCTION current_customer RETURN customer_type;',
        'CREATE TYPE holder AS OBJECT (value customer_type);',
        'TYPE local_list IS TABLE OF customer_type;',
        'TYPE local_array IS VARRAY(5) OF customer_type;',
        'CREATE TYPE child_customer UNDER customer_type (extra NUMBER);'
    ];
    const document = { uri: 'file:///workspace/references.sql', text: lines.join('\n') };

    assert.deepEqual(lines.map((line, index) => findSchemaTypeReferenceAt(
        document,
        index,
        line.lastIndexOf('customer_type') + 2
    )), [
        'customer_type',
        'customer_type',
        'customer_type',
        'customer_type',
        'customer_type',
        'customer_type',
        'customer_type'
    ]);
});

test('TREAT target is recognized as a schema type reference', () => {
    const lines = [
        'l_product := treat(self.get_product(p_key) as t_o2_product_tariff);',
        'l_product := treat(self.get_product(p_key) as product_schema.t_o2_product_tariff);'
    ];
    const document = { uri: 'file:///workspace/T_PRODUCT_MAPPING.sql', text: lines.join('\n') };

    assert.deepEqual(lines.map((line, index) => findSchemaTypeReferenceAt(
        document,
        index,
        line.indexOf('t_o2_product_tariff') + 2
    )), ['t_o2_product_tariff', 't_o2_product_tariff']);
});

test('comments, strings, expressions, and executable returns are not type references', () => {
    const lines = [
        '-- p_value customer_type;',
        "v_text := 'customer_type';",
        'v_customer := customer_type();',
        'customer_type.process;',
        'SELECT value AS customer_type FROM source_table;',
        'v_customer := wrapper(value AS customer_type);',
        'FUNCTION current_customer RETURN NUMBER IS BEGIN RETURN customer_type; END;'
    ];
    const document = { uri: 'file:///workspace/non_references.sql', text: lines.join('\n') };

    assert.deepEqual(lines.map((line, index) => findSchemaTypeReferenceAt(
        document,
        index,
        line.lastIndexOf('customer_type') + 2
    )), [undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
});

test('repository type lookup returns every local specification and body header', () => {
    const specification = extractProgramUnitSymbols({
        uri: 'file:///workspace/customer_type.tps',
        text: 'CREATE TYPE customer_type AS OBJECT (id NUMBER);\n/'
    });
    const body = extractProgramUnitSymbols({
        uri: 'file:///workspace/customer_type.tpb',
        text: 'CREATE TYPE BODY customer_type AS\nEND customer_type;\n/'
    });

    assert.deepEqual(
        findSchemaTypeDefinitions('CUSTOMER_TYPE', [...specification, ...body])
            .map(symbol => ({ uri: symbol.uri, side: symbol.side })),
        [
            { uri: 'file:///workspace/customer_type.tps', side: 'specification' },
            { uri: 'file:///workspace/customer_type.tpb', side: 'body' }
        ]
    );
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

test('ambiguous same-arity implementations are all returned for Peek', () => {
    const specification = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pks',
        text: [
            'CREATE PACKAGE order_api AS',
            '    PROCEDURE submit_order(p_order_id RAW);',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const body = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pkb',
        text: [
            'CREATE PACKAGE BODY order_api AS',
            '    PROCEDURE submit_order(p_order_id NUMBER) IS BEGIN NULL; END;',
            '    PROCEDURE submit_order(p_order_code VARCHAR2) IS BEGIN NULL; END;',
            '    PROCEDURE submit_order(p_order_id NUMBER, p_note VARCHAR2) IS BEGIN NULL; END;',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const declaration = specification.find(symbol => symbol.kind === 'procedure');

    assert.ok(declaration);
    assert.deepEqual(findCounterparts(declaration, body).map(symbol => symbol.line), [1, 2, 3]);
});

test('compact parameter default does not prevent exact overload navigation', () => {
    const specification = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pks',
        text: [
            'CREATE PACKAGE order_api AS',
            '    PROCEDURE submit_order(p_order_id NUMBER:=1);',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const body = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pkb',
        text: [
            'CREATE PACKAGE BODY order_api AS',
            '    PROCEDURE submit_order(p_order_id NUMBER) IS BEGIN NULL; END;',
            '    PROCEDURE submit_order(p_order_code VARCHAR2) IS BEGIN NULL; END;',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const declaration = specification.find(symbol => symbol.kind === 'procedure');

    assert.ok(declaration);
    assert.deepEqual(findCounterparts(declaration, body).map(symbol => symbol.line), [1]);
});

test('multiline parameter default does not prevent exact overload navigation', () => {
    const specification = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pks',
        text: [
            'CREATE PACKAGE order_api AS',
            '    PROCEDURE submit_order(p_order_id NUMBER := make_default(',
            '        1));',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const body = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pkb',
        text: [
            'CREATE PACKAGE BODY order_api AS',
            '    PROCEDURE submit_order(p_order_id NUMBER) IS BEGIN NULL; END;',
            '    PROCEDURE submit_order(p_order_code VARCHAR2) IS BEGIN NULL; END;',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const declaration = specification.find(symbol => symbol.kind === 'procedure');

    assert.ok(declaration);
    assert.deepEqual(findCounterparts(declaration, body).map(symbol => symbol.line), [1]);
});

test('incomplete member signature finds its only valid counterpart', () => {
    const specification = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pks',
        text: [
            'CREATE PACKAGE order_api AS',
            '    PROCEDURE run('
        ].join('\n')
    });
    const body = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pkb',
        text: [
            'CREATE PACKAGE BODY order_api AS',
            '    PROCEDURE run(p_order_id NUMBER) IS BEGIN NULL; END;',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const declaration = specification.find(symbol => symbol.kind === 'procedure');

    assert.ok(declaration);
    assert.deepEqual(findCounterparts(declaration, body).map(symbol => symbol.line), [1]);
});

test('incomplete signature opens all overloads instead of exactly matching zero parameters', () => {
    const incompleteSpecification = extractProgramUnitSymbols({
        uri: 'file:///workspace/incomplete_order_api.pks',
        text: 'CREATE PACKAGE order_api AS\n    PROCEDURE run('
    });
    const completeSpecification = extractProgramUnitSymbols({
        uri: 'file:///workspace/complete_order_api.pks',
        text: 'CREATE PACKAGE order_api AS\n    PROCEDURE run();\nEND order_api;'
    });
    const body = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pkb',
        text: [
            'CREATE PACKAGE BODY order_api AS',
            '    PROCEDURE run() IS BEGIN NULL; END;',
            '    PROCEDURE run(p_order_id NUMBER) IS BEGIN NULL; END;',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const incomplete = incompleteSpecification.find(symbol => symbol.kind === 'procedure');
    const complete = completeSpecification.find(symbol => symbol.kind === 'procedure');

    assert.ok(incomplete);
    assert.ok(complete);
    assert.deepEqual({
        incomplete: findCounterparts(incomplete, body).map(symbol => symbol.line),
        complete: findCounterparts(complete, body).map(symbol => symbol.line)
    }, {
        incomplete: [1, 2],
        complete: [1]
    });
});

test('incomplete public declaration excludes private-forward-declared implementations', () => {
    const specification = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pks',
        text: 'CREATE PACKAGE order_api AS\n    PROCEDURE run('
    });
    const body = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pkb',
        text: [
            'CREATE PACKAGE BODY order_api AS',
            '    PROCEDURE run(p_order_code VARCHAR2);',
            '    PROCEDURE run(p_order_id NUMBER) IS BEGIN NULL; END;',
            '    PROCEDURE run(p_order_code VARCHAR2) IS BEGIN NULL; END;',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const declaration = specification.find(symbol => symbol.kind === 'procedure');

    assert.ok(declaration);
    assert.deepEqual(findCounterparts(declaration, body).map(symbol => symbol.line), [2]);
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

test('private forward declaration navigates only to its local implementation', () => {
    const symbols = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pkb',
        text: [
            'CREATE PACKAGE BODY order_api AS',
            '    PROCEDURE normalize_order(p_order_id NUMBER);',
            '    PROCEDURE normalize_order(p_order_id NUMBER) IS',
            '    BEGIN',
            '        NULL;',
            '    END normalize_order;',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const declaration = symbols.find(symbol => symbol.line === 1);
    const implementation = symbols.find(symbol => symbol.line === 2);

    assert.ok(declaration);
    assert.ok(implementation);
    assert.equal(findNavigationTargets(declaration, symbols, 'implementation')[0], implementation);
    assert.equal(findNavigationTargets(implementation, symbols, 'declaration')[0], declaration);
    assert.equal(findNavigationTargets(declaration, symbols, 'definition')[0], implementation);
    assert.equal(findNavigationTargets(implementation, symbols, 'definition')[0], declaration);
    assert.deepEqual(findNavigationTargets(declaration, symbols, 'declaration'), []);
});

test('incomplete private forward declaration opens all local implementations', () => {
    const symbols = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pkb',
        text: [
            'CREATE PACKAGE BODY order_api AS',
            '    PROCEDURE run(',
            '    PROCEDURE run IS BEGIN NULL; END;',
            '    PROCEDURE run(p_order_id NUMBER) IS BEGIN NULL; END;',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const declaration = symbols.find(symbol =>
        symbol.kind === 'procedure' && symbol.line === 1
    );

    assert.ok(declaration);
    assert.deepEqual(
        findNavigationTargets(declaration, symbols, 'implementation').map(symbol => symbol.line),
        [2, 3]
    );
});

test('private overload is not presented as a public specification counterpart', () => {
    const symbols = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.sql',
        text: [
            'CREATE PACKAGE order_api AS',
            '    PROCEDURE normalize_order(p_order_id NUMBER);',
            'END order_api;',
            '/',
            'CREATE PACKAGE BODY order_api AS',
            '    PROCEDURE normalize_order(p_order_code VARCHAR2) IS BEGIN NULL; END;',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const privateImplementation = symbols.find(symbol => symbol.line === 5);

    assert.ok(privateImplementation);
    assert.deepEqual(findNavigationTargets(privateImplementation, symbols, 'declaration'), []);
    assert.deepEqual(findNavigationTargets(privateImplementation, symbols, 'definition'), []);
});

test('public declaration does not fall back to a private forward-declared overload', () => {
    const symbols = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.sql',
        text: [
            'CREATE PACKAGE order_api AS',
            '    PROCEDURE normalize_order(p_order_id NUMBER);',
            'END order_api;',
            '/',
            'CREATE PACKAGE BODY order_api AS',
            '    PROCEDURE normalize_order(p_order_code VARCHAR2);',
            '    PROCEDURE normalize_order(p_order_code VARCHAR2) IS BEGIN NULL; END;',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const publicDeclaration = symbols.find(symbol => symbol.line === 1);
    const privateDeclaration = symbols.find(symbol => symbol.line === 5);
    const privateImplementation = symbols.find(symbol => symbol.line === 6);

    assert.ok(publicDeclaration);
    assert.ok(privateDeclaration);
    assert.ok(privateImplementation);
    assert.deepEqual(findNavigationTargets(publicDeclaration, symbols, 'implementation'), []);
    assert.equal(
        findNavigationTargets(privateImplementation, symbols, 'declaration')[0],
        privateDeclaration
    );
});

test('public specification is preferred over a same-body forward declaration', () => {
    const symbols = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.sql',
        text: [
            'CREATE PACKAGE order_api AS',
            '    PROCEDURE normalize_order(p_order_id NUMBER);',
            'END order_api;',
            '/',
            'CREATE PACKAGE BODY order_api AS',
            '    PROCEDURE normalize_order(p_order_id NUMBER);',
            '    PROCEDURE normalize_order(p_order_id NUMBER) IS BEGIN NULL; END;',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const publicDeclaration = symbols.find(symbol => symbol.line === 1);
    const implementation = symbols.find(symbol => symbol.line === 6);

    assert.ok(publicDeclaration);
    assert.ok(implementation);
    assert.equal(
        findNavigationTargets(implementation, symbols, 'declaration')[0],
        publicDeclaration
    );
});

test('member without a counterpart returns no navigation target', () => {
    const symbols = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.pks',
        text: [
            'CREATE PACKAGE order_api AS',
            '    PROCEDURE cancel_order(p_order_id NUMBER);',
            'END order_api;',
            '/'
        ].join('\n')
    });
    const declaration = symbols.find(symbol => symbol.kind === 'procedure');

    assert.ok(declaration);
    assert.deepEqual(findNavigationTargets(declaration, symbols, 'definition'), []);
    assert.deepEqual(findNavigationTargets(declaration, symbols, 'implementation'), []);
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

test('nested subprogram cannot satisfy a direct member declaration', () => {
    const symbols = extractProgramUnitSymbols({
        uri: 'file:///workspace/order_api.sql',
        text: [
            'CREATE PACKAGE order_api AS',
            '    PROCEDURE write_audit;',
            'END;',
            '/',
            'CREATE PACKAGE BODY order_api AS',
            '    PROCEDURE submit_order IS',
            '        PROCEDURE write_audit IS BEGIN NULL; END;',
            '    BEGIN',
            '        write_audit;',
            '    END;',
            'END;',
            '/'
        ].join('\n')
    });
    const declaration = symbols.find(symbol =>
        symbol.name === 'write_audit' && symbol.side === 'specification'
    );

    assert.ok(declaration);
    assert.deepEqual(findNavigationTargets(declaration, symbols, 'implementation'), []);
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

test('object method calls resolve self, a local variable, and a collection element', () => {
    const mappingDocument = {
        uri: 'file:///workspace/T_PRODUCT_MAPPING.sql',
        text: [
            'CREATE TYPE t_o2_product_table AS TABLE OF t_o2_product;',
            '/',
            'CREATE TYPE t_product_mapping AS OBJECT (',
            '    o2_prod_tab t_o2_product_table,',
            '    MEMBER FUNCTION get_product_segment(p_key VARCHAR2) RETURN VARCHAR2,',
            '    MEMBER PROCEDURE add_product(p_product t_o2_product)',
            ');',
            '/',
            'CREATE TYPE BODY t_product_mapping AS',
            '    MEMBER PROCEDURE add_product(p_product t_o2_product) IS',
            '        l_product t_o2_product;',
            '    BEGIN',
            '        l_product.product_segment := self.get_product_segment(l_product.parent_key);',
            '        IF o2_prod_tab(i).effective_total_price(p_with_vat => 1)',
            '            = l_product.effective_total_price(p_with_vat => 1) THEN NULL; END IF;',
            '    END;',
            '    MEMBER FUNCTION get_product_segment(p_key VARCHAR2) RETURN VARCHAR2 IS',
            '    BEGIN RETURN NULL; END;',
            'END;',
            '/'
        ].join('\n')
    };
    const productDocument = {
        uri: 'file:///workspace/T_O2_PRODUCT.sql',
        text: [
            'CREATE TYPE t_o2_product AS OBJECT (',
            '    MEMBER FUNCTION effective_total_price(p_with_vat NUMBER) RETURN NUMBER',
            ');',
            '/',
            'CREATE TYPE BODY t_o2_product AS',
            '    MEMBER FUNCTION effective_total_price(p_with_vat NUMBER) RETURN NUMBER IS',
            '    BEGIN RETURN 0; END;',
            'END;',
            '/'
        ].join('\n')
    };
    const allSymbols = [
        ...extractProgramUnitSymbols(mappingDocument),
        ...extractProgramUnitSymbols(productDocument)
    ];

    assert.deepEqual({
        self: resolveMethodAt(mappingDocument, 12, 'get_product_segment', allSymbols)
            .map(symbol => [symbol.programUnitName, symbol.side, symbol.line]),
        collection: resolveMethodAt(mappingDocument, 13, 'effective_total_price', allSymbols)
            .map(symbol => [symbol.programUnitName, symbol.side, symbol.line]),
        local: resolveMethodAt(mappingDocument, 14, 'effective_total_price', allSymbols)
            .map(symbol => [symbol.programUnitName, symbol.side, symbol.line])
    }, {
        self: [
            ['t_product_mapping', 'specification', 4],
            ['t_product_mapping', 'body', 16]
        ],
        collection: [
            ['t_o2_product', 'specification', 1],
            ['t_o2_product', 'body', 5]
        ],
        local: [
            ['t_o2_product', 'specification', 1],
            ['t_o2_product', 'body', 5]
        ]
    });
});

test('object method call resolves a parameter receiver', () => {
    const caller = {
        uri: 'file:///workspace/caller.sql',
        text: [
            'CREATE TYPE caller AS OBJECT (MEMBER PROCEDURE run(p_product t_o2_product));',
            '/',
            'CREATE TYPE BODY caller AS',
            '    MEMBER PROCEDURE run(p_product IN t_o2_product) IS',
            '    BEGIN',
            '        p_product.effective_total_price(p_with_vat => 1);',
            '    END;',
            'END;',
            '/'
        ].join('\n')
    };
    const product = {
        uri: 'file:///workspace/product.sql',
        text: [
            'CREATE TYPE t_o2_product AS OBJECT (',
            '    MEMBER FUNCTION effective_total_price(p_with_vat NUMBER) RETURN NUMBER',
            ');',
            '/'
        ].join('\n')
    };
    const allSymbols = [
        ...extractProgramUnitSymbols(caller),
        ...extractProgramUnitSymbols(product)
    ];

    assert.deepEqual(
        resolveMethodAt(caller, 5, 'effective_total_price', allSymbols).map(symbol => symbol.programUnitName),
        ['t_o2_product']
    );
});

test('object method call follows an UNDER relationship to an inherited member', () => {
    const caller = {
        uri: 'file:///workspace/caller.sql',
        text: [
            'CREATE TYPE caller AS OBJECT (MEMBER PROCEDURE run);',
            '/',
            'CREATE TYPE BODY caller AS',
            '    MEMBER PROCEDURE run IS',
            '        l_product t_discount_product;',
            '    BEGIN',
            '        l_product.effective_total_price(p_with_vat => 1);',
            '    END;',
            'END;',
            '/'
        ].join('\n')
    };
    const base = {
        uri: 'file:///workspace/base.sql',
        text: [
            'CREATE TYPE t_o2_product AS OBJECT (',
            '    MEMBER FUNCTION effective_total_price(p_with_vat NUMBER) RETURN NUMBER',
            ');',
            '/'
        ].join('\n')
    };
    const child = {
        uri: 'file:///workspace/child.sql',
        text: 'CREATE TYPE t_discount_product UNDER t_o2_product (discount NUMBER);\n/'
    };
    const allSymbols = [caller, base, child].flatMap(extractProgramUnitSymbols);

    assert.deepEqual(
        resolveMethodAt(caller, 6, 'effective_total_price', allSymbols).map(symbol => symbol.programUnitName),
        ['t_o2_product']
    );
});

test('named arguments select an overload while positional ambiguity remains available for Peek', () => {
    const caller = {
        uri: 'file:///workspace/caller.sql',
        text: [
            'CREATE TYPE caller AS OBJECT (MEMBER PROCEDURE run);',
            '/',
            'CREATE TYPE BODY caller AS',
            '    MEMBER PROCEDURE run IS l_target target_type;',
            '    BEGIN',
            '        l_target.calculate(p_code => nested_value(1, 2));',
            '        l_target.calculate(l_value);',
            '    END;',
            'END;',
            '/'
        ].join('\n')
    };
    const target = {
        uri: 'file:///workspace/target.sql',
        text: [
            'CREATE TYPE target_type AS OBJECT (',
            '    MEMBER FUNCTION calculate(p_id NUMBER) RETURN NUMBER,',
            '    MEMBER FUNCTION calculate(p_code VARCHAR2, p_mode NUMBER DEFAULT 1) RETURN NUMBER',
            ');',
            '/'
        ].join('\n')
    };
    const allSymbols = [caller, target].flatMap(extractProgramUnitSymbols);

    assert.deepEqual({
        named: resolveMethodAt(caller, 5, 'calculate', allSymbols).map(symbol => symbol.signature),
        ambiguous: resolveMethodAt(caller, 6, 'calculate', allSymbols).map(symbol => symbol.signature)
    }, {
        named: ['VARCHAR2,NUMBER'],
        ambiguous: ['NUMBER', 'VARCHAR2,NUMBER']
    });
});

test('comments, strings, attributes, and unknown receivers are not object method calls', () => {
    const lines = [
        '-- l_product.effective_total_price(p_with_vat => 1);',
        "l_text := 'l_product.effective_total_price(p_with_vat => 1)';",
        'l_product.effective_total_price;',
        'unknown.effective_total_price(p_with_vat => 1);'
    ];
    const document = { uri: 'file:///workspace/caller.sql', text: lines.join('\n') };

    assert.deepEqual(lines.map((line, index) => resolveObjectMethodCall(
        document,
        index,
        line.indexOf('effective_total_price') + 2,
        [],
        () => []
    )), [[], [], [], []]);
});
