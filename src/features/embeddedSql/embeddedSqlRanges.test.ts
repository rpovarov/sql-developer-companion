import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    buildEmbeddedSqlBackground,
    findEmbeddedSqlRanges,
} from './embeddedSqlRanges';

function contents(text: string): string[] {
    return findEmbeddedSqlRanges(text).map((range) =>
        text.slice(range.start, range.end),
    );
}

test('finds embedded SQL contents without decorating Python delimiters', () => {
    const text = [
        'query = """',
        'SELECT *',
        'FROM all_objects',
        '"""',
    ].join('\n');

    assert.deepEqual(contents(text), ['\nSELECT *\nFROM all_objects\n']);
});

test('finds raw assignments and direct execute calls', () => {
    const text = [
        "sql_text = r'''SELECT 1 FROM dual'''",
        'cursor.execute(R"""DELETE FROM jobs""")',
        "db_cursor.executemany('''INSERT INTO jobs VALUES (:1)''')",
    ].join('\n');

    assert.deepEqual(contents(text), [
        'SELECT 1 FROM dual',
        'DELETE FROM jobs',
        'INSERT INTO jobs VALUES (:1)',
    ]);
});

test('finds a first SQL argument moved below execute opening parenthesis', () => {
    const text = [
        'cursor.execute(',
        '    """',
        '    BEGIN',
        '        do_work(p_value => :value);',
        '    END;',
        '    """,',
        '    value=value,',
        ')',
    ].join('\n');

    assert.deepEqual(contents(text), [
        '\n    BEGIN\n        do_work(p_value => :value);\n    END;\n    ',
    ]);
    assert.deepEqual(buildEmbeddedSqlBackground(text), {
        wholeLines: [2, 3, 4],
        inlineRanges: [],
    });
});

test('finds implicitly concatenated SQL f-strings passed to execute', () => {
    const fragments = [
        `SELECT '\\"' || column_name || '\\"' `,
        'FROM user_tab_columns ',
        "WHERE table_name='{table_name}' ",
        'AND column_name NOT IN ({excluded_columns}) ',
        'ORDER BY column_id',
    ];
    const text = [
        'cursor.execute(',
        `    f"${fragments[0]}"`,
        `    f"${fragments[1]}"`,
        `    f"${fragments[2]}"`,
        `    f"${fragments[3]}"`,
        `    f"${fragments[4]}")`,
    ].join('\n');

    assert.deepEqual(contents(text), fragments);
    assert.deepEqual(buildEmbeddedSqlBackground(text).wholeLines, []);
    assert.deepEqual(
        buildEmbeddedSqlBackground(text).inlineRanges.map((range) =>
            text.slice(range.start, range.end),
        ),
        fragments,
    );
});

test('finds a single-line SQL string passed below execute opening parenthesis', () => {
    const statements = [
        'delete from mig_core_target_operation where migration_scope_key = :scope_key',
        'delete from mig_core_ho_poznamka_profile where profile_key = :profile_key',
    ];
    const text = [
        'cursor.execute(',
        `    "${statements[0]}",`,
        '    scope_key=scope,',
        ')',
        'cursor.execute(',
        `    "${statements[1]}",`,
        '    profile_key=profile_key,',
        ')',
    ].join('\n');

    assert.deepEqual(contents(text), statements);
    assert.deepEqual(buildEmbeddedSqlBackground(text).wholeLines, []);
    assert.deepEqual(
        buildEmbeddedSqlBackground(text).inlineRanges.map((range) =>
            text.slice(range.start, range.end),
        ),
        statements,
    );
});

test('finds implicitly concatenated strings in a parenthesized SQL assignment', () => {
    const fragments = [
        'select count(distinct o.ca_ref_no) ',
        'from TE_TREE_SCHEDULE t ',
        'join L1_TE_ODS o on o.TTS_ID = t.TTS_ID ',
        "where t.TTS_ENTITY_TYPE in ('L2_CUSTOMER', 'L2_ACCOUNT') ",
        '  and o.CA_REF_NO is not null ',
        '  and t.TTS_WAVE_ID = :wave_id',
    ];
    const text = [
        'count_query = (',
        `    "${fragments[0]}"`,
        `    "${fragments[1]}"`,
        `    "${fragments[2]}"`,
        `    "${fragments[3]}"`,
        '    # "  and t.TTS_STATUS = 1 "',
        `    "${fragments[4]}"`,
        `    "${fragments[5]}"`,
        ')',
    ].join('\n');

    assert.deepEqual(contents(text), fragments);
    assert.deepEqual(buildEmbeddedSqlBackground(text).wholeLines, []);
    assert.deepEqual(
        buildEmbeddedSqlBackground(text).inlineRanges.map((range) =>
            text.slice(range.start, range.end),
        ),
        fragments,
    );
});

test('finds a triple-quoted SQL f-string assigned to a SQL-like name', () => {
    const text = [
        'source_sql = f"""',
        'SELECT projected.*',
        'FROM TABLE(pkg.consume.{function_name}(:wave_id)) projected',
        '"""',
    ].join('\n');

    assert.deepEqual(contents(text), [
        '\nSELECT projected.*\nFROM TABLE(pkg.consume.{function_name}(:wave_id)) projected\n',
    ]);
    assert.deepEqual(buildEmbeddedSqlBackground(text), {
        wholeLines: [1, 2],
        inlineRanges: [],
    });
});

test('ignores f-strings, unrelated strings, and commented examples', () => {
    const text = [
        'description = f"""SELECT * FROM {table_name}"""',
        'description = """SELECT is only prose here"""',
        '# query = """SELECT * FROM hidden"""',
        '# cursor.execute("""DELETE FROM hidden""")',
    ].join('\n');

    assert.deepEqual(findEmbeddedSqlRanges(text), []);
});

test('decorates an unfinished SQL string through the end of the document', () => {
    const text = 'statement = """\nSELECT *\nFROM all_objects';

    assert.deepEqual(contents(text), ['\nSELECT *\nFROM all_objects']);
});

test('uses full-width rows only for complete SQL content lines', () => {
    const text = [
        'query = """',
        'SELECT *',
        'FROM all_objects',
        '"""',
    ].join('\n');

    assert.deepEqual(buildEmbeddedSqlBackground(text), {
        wholeLines: [1, 2],
        inlineRanges: [],
    });
});

test('does not decorate whitespace before an indented closing delimiter', () => {
    const text = [
        '    query = """',
        '        SELECT *',
        '        FROM all_objects',
        '    """',
    ].join('\n');

    assert.deepEqual(buildEmbeddedSqlBackground(text), {
        wholeLines: [1, 2],
        inlineRanges: [],
    });
});

test('keeps SQL beside Python syntax as an inline background', () => {
    const text = 'cursor.execute("""SELECT 1 FROM dual""")';
    const sql = 'SELECT 1 FROM dual';
    const start = text.indexOf(sql);

    assert.deepEqual(buildEmbeddedSqlBackground(text), {
        wholeLines: [],
        inlineRanges: [{ start, end: start + sql.length }],
    });
});
