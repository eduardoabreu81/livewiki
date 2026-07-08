/**
 * Sample Python code for indexer tests. Cobre function_definition e class_definition.
 */

def greet(name: str) -> str:
    return f"hello, {name}"


class Calculator:
    def add(self, a: int, b: int) -> int:
        return a + b

    def subtract(self, a: int, b: int) -> int:
        return a - b


def deprecated_py_helper(x: int) -> int:
    return x * 2