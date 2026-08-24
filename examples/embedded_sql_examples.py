"""Fictional editor fixtures; the functions are not intended to be executed."""

from typing import Any


def named_string_forms(owner: str, projection_name: str) -> tuple[str, str, str]:
    query = """
    SELECT object_type, object_name
    FROM all_objects
    WHERE owner = :owner
    ORDER BY object_name
    """

    ddl = r'''
    CREATE TABLE demo_work_queue (
        item_id NUMBER,
        status VARCHAR2(20)
    )
    '''

    # SQL remains highlighted; {projection_name} remains Python.
    source_sql = f"""
    SELECT {projection_name}
    FROM TABLE(demo_report_rows(:owner))
    """

    return query, ddl, source_sql


def implicit_concatenation() -> str:
    count_query = (
        "SELECT COUNT(DISTINCT item_id) "
        "FROM demo_work_queue "
        # "WHERE archived = 'N' "
        "WHERE status = :status"
    )
    return count_query


def direct_execution_forms(
    cursor: Any,
    item_id: int,
    table_name: str,
    excluded_columns: str,
) -> None:
    cursor.execute("""SELECT COUNT(*) FROM demo_work_queue""")

    cursor.execute(
        "DELETE FROM demo_work_queue WHERE item_id = :item_id",
        item_id=item_id,
    )

    cursor.execute(
        r"SELECT item_id FROM demo_work_queue WHERE status = :status",
        status="READY",
    )

    cursor.executemany(
        '''
        INSERT INTO demo_work_queue (item_id, status)
        VALUES (:1, :2)
        ''',
        [(item_id, "READY")],
    )

    # Adjacent f-strings keep SQL coloring and Python interpolation.
    cursor.execute(
        f"SELECT '\"' || column_name || '\"' "
        f"FROM user_tab_columns "
        f"WHERE table_name = '{table_name}' "
        f"AND column_name NOT IN ({excluded_columns}) "
        f"ORDER BY column_id"
    )


def repository_navigation(
    cursor: Any,
    item_code: str,
    payload: str,
) -> None:
    result = cursor.var(int)

    cursor.execute(
        """
        DECLARE
            l_item demo_item_type;
        BEGIN
            :result := demo_repository_api.reserve_item(
                p_item_code => :item_code,
                p_priority => 5
            );

            l_item := demo_item_type.from_json(
                p_json => :payload
            );
            demo_repository_api.update_item(
                p_item => l_item,
                p_item_name => 'renamed'
            );
        END;
        """,
        result=result,
        item_code=item_code,
        payload=payload,
    )


def deliberately_not_navigation(package_name: str) -> str:
    # Dynamic and unqualified names are highlighted but not Ctrl+Click targets.
    statement = f"""
    BEGIN
        {package_name}.reserve_item(p_item_id => 1);
        reserve_item(p_item_id => 1);
    END;
    """
    return statement
