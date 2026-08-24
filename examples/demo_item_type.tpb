CREATE OR REPLACE TYPE BODY demo_item_type AS

    CONSTRUCTOR FUNCTION demo_item_type(
        SELF IN OUT NOCOPY demo_item_type
    ) RETURN SELF AS RESULT IS
    BEGIN
        RETURN;
    END demo_item_type;

    CONSTRUCTOR FUNCTION demo_item_type(
        SELF IN OUT NOCOPY demo_item_type,
        p_item_id IN NUMBER,
        p_item_name IN VARCHAR2 DEFAULT NULL
    ) RETURN SELF AS RESULT IS
    BEGIN
        SELF.item_id := p_item_id;
        SELF.item_name := p_item_name;
        RETURN;
    END demo_item_type;

    MEMBER PROCEDURE rename(
        p_item_name IN VARCHAR2
    ) IS
    BEGIN
        SELF.item_name := p_item_name;
    END rename;

    MEMBER FUNCTION display_name RETURN VARCHAR2 IS
    BEGIN
        RETURN COALESCE(SELF.item_name, 'item-' || SELF.item_id);
    END display_name;

    MEMBER FUNCTION score(
        p_value IN NUMBER
    ) RETURN NUMBER IS
    BEGIN
        RETURN NVL(p_value, 0) + SELF.item_id;
    END score;

    MEMBER FUNCTION score(
        p_text IN VARCHAR2
    ) RETURN NUMBER IS
    BEGIN
        RETURN LENGTH(p_text) + SELF.item_id;
    END score;

    STATIC FUNCTION from_json(
        p_json IN CLOB
    ) RETURN demo_item_type IS
    BEGIN
        RETURN demo_item_type(0, DBMS_LOB.SUBSTR(p_json, 100, 1));
    END from_json;

END demo_item_type;
/
