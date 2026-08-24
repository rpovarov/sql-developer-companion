CREATE OR REPLACE PACKAGE BODY demo_repository_api AS

    -- Private forward declaration pairs only with its body implementation.
    PROCEDURE trace_message(p_message IN VARCHAR2);

    FUNCTION reserve_item(
        p_item_id IN NUMBER
    ) RETURN NUMBER IS
    BEGIN
        RETURN p_item_id;
    END reserve_item;

    FUNCTION reserve_item(
        p_item_code IN VARCHAR2,
        p_priority IN NUMBER DEFAULT 0
    ) RETURN NUMBER IS
    BEGIN
        RETURN LENGTH(p_item_code) + p_priority;
    END reserve_item;

    FUNCTION load_item(
        p_item_id IN NUMBER
    ) RETURN demo_item_type IS
    BEGIN
        RETURN demo_item_type(p_item_id, 'demo');
    END load_item;

    PROCEDURE update_item(
        p_item IN OUT NOCOPY demo_item_type,
        p_item_name IN VARCHAR2
    ) IS
    BEGIN
        p_item.rename(p_item_name => p_item_name);
        trace_message(p_item.display_name());
    END update_item;

    FUNCTION describe_items(
        p_item_id IN NUMBER
    ) RETURN VARCHAR2 IS
        l_item demo_item_type;
        l_items demo_item_list_type;
        l_numeric_score NUMBER;
        l_text_score NUMBER;
    BEGIN
        l_item := load_item(p_item_id);
        l_items := demo_item_list_type(l_item);

        -- Named arguments select the correct overload.
        l_numeric_score := l_item.score(p_value => 10);
        l_text_score := l_items(1).score(p_text => 'ten');

        RETURN l_item.display_name()
            || ':' || l_numeric_score
            || ':' || l_text_score;
    END describe_items;

    PROCEDURE trace_message(p_message IN VARCHAR2) IS
    BEGIN
        DBMS_OUTPUT.PUT_LINE(p_message);
    END trace_message;

END demo_repository_api;
/
