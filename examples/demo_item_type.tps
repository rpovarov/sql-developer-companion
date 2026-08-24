CREATE OR REPLACE TYPE demo_item_type FORCE AS OBJECT (
    item_id NUMBER,
    item_name VARCHAR2(100),

    CONSTRUCTOR FUNCTION demo_item_type(
        SELF IN OUT NOCOPY demo_item_type
    ) RETURN SELF AS RESULT,

    CONSTRUCTOR FUNCTION demo_item_type(
        SELF IN OUT NOCOPY demo_item_type,
        p_item_id IN NUMBER,
        p_item_name IN VARCHAR2 DEFAULT NULL
    ) RETURN SELF AS RESULT,

    MEMBER PROCEDURE rename(
        p_item_name IN VARCHAR2
    ),

    MEMBER FUNCTION display_name RETURN VARCHAR2,

    MEMBER FUNCTION score(
        p_value IN NUMBER
    ) RETURN NUMBER,

    MEMBER FUNCTION score(
        p_text IN VARCHAR2
    ) RETURN NUMBER,

    STATIC FUNCTION from_json(
        p_json IN CLOB
    ) RETURN demo_item_type
) NOT FINAL;
/
