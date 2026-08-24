CREATE OR REPLACE PACKAGE demo_repository_api AS

    FUNCTION reserve_item(
        p_item_id IN NUMBER
    ) RETURN NUMBER;

    FUNCTION reserve_item(
        p_item_code IN VARCHAR2,
        p_priority IN NUMBER DEFAULT 0
    ) RETURN NUMBER;

    FUNCTION load_item(
        p_item_id IN NUMBER
    ) RETURN demo_item_type;

    PROCEDURE update_item(
        p_item IN OUT NOCOPY demo_item_type,
        p_item_name IN VARCHAR2
    );

    FUNCTION describe_items(
        p_item_id IN NUMBER
    ) RETURN VARCHAR2;

END demo_repository_api;
/
