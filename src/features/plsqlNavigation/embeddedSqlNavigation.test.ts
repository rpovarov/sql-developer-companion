import assert from 'node:assert/strict';
import test from 'node:test';
import { extractProgramUnitSymbols, ProgramUnitSymbol } from './semanticNavigation';
import { resolveEmbeddedSqlReferenceAt } from './embeddedSqlNavigation';

function symbols(uri: string, text: string): ProgramUnitSymbol[] {
    return extractProgramUnitSymbols({ uri, text });
}

function lookup(allSymbols: readonly ProgramUnitSymbol[]) {
    return (name: string) => allSymbols.filter(symbol =>
        symbol.name.toLowerCase() === name.toLowerCase()
    );
}

test('resolves a package call from embedded PL/SQL to the requested side', () => {
    const allSymbols = [
        ...symbols('file:///repo/order_api.pks', [
            'CREATE PACKAGE order_api AS',
            '    PROCEDURE submit_order(p_order_id NUMBER);',
            'END order_api;',
            '/',
        ].join('\n')),
        ...symbols('file:///repo/order_api.pkb', [
            'CREATE PACKAGE BODY order_api AS',
            '    PROCEDURE submit_order(p_order_id NUMBER) IS BEGIN NULL; END;',
            'END order_api;',
            '/',
        ].join('\n')),
    ];
    const python = [
        'cursor.execute("""',
        'BEGIN',
        '    order_api.submit_order(p_order_id => :order_id);',
        'END;',
        '""")',
    ].join('\n');
    const memberOffset = python.indexOf('submit_order') + 2;

    const declaration = resolveEmbeddedSqlReferenceAt(
        python, memberOffset, lookup(allSymbols), 'declaration', 'body',
    );
    const implementation = resolveEmbeddedSqlReferenceAt(
        python, memberOffset, lookup(allSymbols), 'implementation', 'body',
    );
    const packageDefinition = resolveEmbeddedSqlReferenceAt(
        python,
        python.indexOf('order_api') + 2,
        lookup(allSymbols),
        'definition',
        'both',
    );

    assert.deepEqual(declaration?.targets.map(target => target.uri), [
        'file:///repo/order_api.pks',
    ]);
    assert.deepEqual(implementation?.targets.map(target => target.uri), [
        'file:///repo/order_api.pkb',
    ]);
    assert.deepEqual(packageDefinition?.targets.map(target => target.uri), [
        'file:///repo/order_api.pks',
        'file:///repo/order_api.pkb',
    ]);
    assert.equal(python.slice(declaration?.start, declaration?.end), 'submit_order');
});

test('definition target and named arguments select the matching overload', () => {
    const allSymbols = [
        ...symbols('file:///repo/order_api.pks', [
            'CREATE PACKAGE order_api AS',
            '    PROCEDURE submit_order;',
            '    PROCEDURE submit_order(p_order_id NUMBER);',
            '    PROCEDURE submit_order(p_order_code VARCHAR2);',
            'END order_api;',
            '/',
        ].join('\n')),
        ...symbols('file:///repo/order_api.pkb', [
            'CREATE PACKAGE BODY order_api AS',
            '    PROCEDURE submit_order IS BEGIN NULL; END;',
            '    PROCEDURE submit_order(p_order_id NUMBER) IS BEGIN NULL; END;',
            '    PROCEDURE submit_order(p_order_code VARCHAR2) IS BEGIN NULL; END;',
            'END order_api;',
            '/',
        ].join('\n')),
    ];
    const python = 'query = """BEGIN order_api.submit_order(p_order_code => :code); END;"""';
    const offset = python.indexOf('submit_order') + 2;

    const resolution = resolveEmbeddedSqlReferenceAt(
        python, offset, lookup(allSymbols), 'definition', 'both',
    );

    assert.deepEqual(resolution?.targets.map(target => ({
        uri: target.uri,
        parameterNames: target.parameterNames,
    })), [
        { uri: 'file:///repo/order_api.pks', parameterNames: ['p_order_code'] },
        { uri: 'file:///repo/order_api.pkb', parameterNames: ['p_order_code'] },
    ]);
});

test('resolves a type name and its static method', () => {
    const allSymbols = [
        ...symbols('file:///repo/order_factory.tps', [
            'CREATE TYPE order_factory AS OBJECT (',
            '    STATIC FUNCTION make_order(p_order_id NUMBER) RETURN order_factory',
            ');',
            '/',
        ].join('\n')),
        ...symbols('file:///repo/order_factory.tpb', [
            'CREATE TYPE BODY order_factory AS',
            '    STATIC FUNCTION make_order(p_order_id NUMBER) RETURN order_factory IS',
            '    BEGIN RETURN NULL; END;',
            'END order_factory;',
            '/',
        ].join('\n')),
    ];
    const python = [
        'statement = """',
        'DECLARE l_order order_factory;',
        'BEGIN',
        '    :result := order_factory.make_order(p_order_id => :order_id);',
        'END;',
        '"""',
    ].join('\n');

    const typeResolution = resolveEmbeddedSqlReferenceAt(
        python,
        python.indexOf('order_factory') + 2,
        lookup(allSymbols),
        'declaration',
        'body',
    );
    const methodResolution = resolveEmbeddedSqlReferenceAt(
        python,
        python.indexOf('make_order') + 2,
        lookup(allSymbols),
        'implementation',
        'body',
    );

    assert.deepEqual(typeResolution?.targets.map(target => target.uri), [
        'file:///repo/order_factory.tps',
    ]);
    assert.deepEqual(methodResolution?.targets.map(target => target.uri), [
        'file:///repo/order_factory.tpb',
    ]);
});

test('ignores ordinary Python, dynamic interpolation, and unqualified calls', () => {
    const allSymbols = symbols(
        'file:///repo/order_api.pks',
        'CREATE PACKAGE order_api AS\nPROCEDURE submit_order;\nEND order_api;\n/',
    );
    const cases = [
        'order_api.submit_order()',
        'query = f"""BEGIN {package_name}.submit_order(); END;"""',
        'query = """BEGIN submit_order(); END;"""',
        'query = ("order_api." "submit_order()")',
        'query = """BEGIN -- order_api.submit_order();\nNULL; END;"""',
        "query = \"\"\"BEGIN log_message('order_api.submit_order()'); END;\"\"\"",
    ];

    for (const python of cases) {
        const offset = python.indexOf('submit_order') + 2;
        assert.equal(
            resolveEmbeddedSqlReferenceAt(
                python, offset, lookup(allSymbols), 'definition', 'both',
            ),
            undefined,
        );
    }
});
