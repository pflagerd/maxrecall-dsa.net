import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

// Minimal hand-rolled JSON value/parser used by the per-submission Java
// harness (judge/runner.js's buildJavaSource). Compiled once (here, at
// server startup) into JudgeJson.class and put on both javac's and java's
// classpath for every submission, rather than recompiled from source on
// every single Run/Submit — the same role judge/cpp/judge_json.{hpp,cpp}
// plays for the C++ judge.
public final class JudgeJson {
    private JudgeJson() {}

    public enum Kind { NULL, BOOLEAN, NUMBER, STRING, ARRAY, OBJECT }

    public static final class Value {
        public final Kind kind;
        private boolean boolValue;
        private double numValue;
        private String strValue;
        private List<Value> arrValue;
        private LinkedHashMap<String, Value> objValue;

        private Value(Kind kind) { this.kind = kind; }

        public static Value ofNull() { return new Value(Kind.NULL); }
        public static Value of(boolean b) { Value v = new Value(Kind.BOOLEAN); v.boolValue = b; return v; }
        public static Value of(long n) { Value v = new Value(Kind.NUMBER); v.numValue = n; return v; }
        public static Value of(double n) { Value v = new Value(Kind.NUMBER); v.numValue = n; return v; }
        public static Value of(String s) { if (s == null) return ofNull(); Value v = new Value(Kind.STRING); v.strValue = s; return v; }
        public static Value array() { Value v = new Value(Kind.ARRAY); v.arrValue = new ArrayList<>(); return v; }
        public static Value object() { Value v = new Value(Kind.OBJECT); v.objValue = new LinkedHashMap<>(); return v; }

        public Value add(Value item) { arrValue.add(item); return this; }
        public Value set(String key, Value item) { objValue.put(key, item); return this; }

        public int size() { return kind == Kind.ARRAY ? arrValue.size() : objValue.size(); }
        public Value get(int index) { return arrValue.get(index); }

        public Value get(String key) {
            Value v = objValue.get(key);
            if (v == null) throw new NoSuchElementException("Missing key: " + key);
            return v;
        }

        public boolean isNull() { return kind == Kind.NULL; }
        public int asInt() { return (int) numValue; }
        public boolean asBoolean() { return boolValue; }
        public String asString() { return strValue; }

        public int[] asIntArray() {
            int[] out = new int[arrValue.size()];
            for (int i = 0; i < out.length; i++) out[i] = arrValue.get(i).asInt();
            return out;
        }

        public String dump() {
            StringBuilder sb = new StringBuilder();
            dumpTo(sb);
            return sb.toString();
        }

        private void dumpTo(StringBuilder sb) {
            switch (kind) {
                case NULL:
                    sb.append("null");
                    break;
                case BOOLEAN:
                    sb.append(boolValue);
                    break;
                case NUMBER:
                    if (numValue == Math.floor(numValue) && !Double.isInfinite(numValue)) sb.append((long) numValue);
                    else sb.append(numValue);
                    break;
                case STRING:
                    dumpString(strValue, sb);
                    break;
                case ARRAY:
                    sb.append('[');
                    for (int i = 0; i < arrValue.size(); i++) {
                        if (i > 0) sb.append(',');
                        arrValue.get(i).dumpTo(sb);
                    }
                    sb.append(']');
                    break;
                case OBJECT:
                    sb.append('{');
                    boolean first = true;
                    for (Map.Entry<String, Value> e : objValue.entrySet()) {
                        if (!first) sb.append(',');
                        first = false;
                        dumpString(e.getKey(), sb);
                        sb.append(':');
                        e.getValue().dumpTo(sb);
                    }
                    sb.append('}');
                    break;
            }
        }

        private static void dumpString(String s, StringBuilder sb) {
            sb.append('"');
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                switch (c) {
                    case '"': sb.append("\\\""); break;
                    case '\\': sb.append("\\\\"); break;
                    case '\n': sb.append("\\n"); break;
                    case '\r': sb.append("\\r"); break;
                    case '\t': sb.append("\\t"); break;
                    default:
                        if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                        else sb.append(c);
                }
            }
            sb.append('"');
        }
    }

    public static Value parse(String input) {
        Parser p = new Parser(input);
        return p.parseValue();
    }

    private static final class Parser {
        private final String s;
        private int pos;

        Parser(String s) { this.s = s; }

        private void skipWhitespace() {
            while (pos < s.length() && Character.isWhitespace(s.charAt(pos))) pos++;
        }

        private void expect(String literal) {
            if (!s.regionMatches(pos, literal, 0, literal.length())) {
                throw new RuntimeException("Expected '" + literal + "' at position " + pos);
            }
            pos += literal.length();
        }

        Value parseValue() {
            skipWhitespace();
            char c = s.charAt(pos);
            if (c == '{') return parseObject();
            if (c == '[') return parseArray();
            if (c == '"') return Value.of(parseString());
            if (c == 't') { expect("true"); return Value.of(true); }
            if (c == 'f') { expect("false"); return Value.of(false); }
            if (c == 'n') { expect("null"); return Value.ofNull(); }
            return parseNumber();
        }

        private Value parseObject() {
            pos++; // {
            Value obj = Value.object();
            skipWhitespace();
            if (s.charAt(pos) == '}') { pos++; return obj; }
            while (true) {
                skipWhitespace();
                String key = parseString();
                skipWhitespace();
                pos++; // :
                Value value = parseValue();
                obj.set(key, value);
                skipWhitespace();
                if (s.charAt(pos++) == '}') break;
            }
            return obj;
        }

        private Value parseArray() {
            pos++; // [
            Value arr = Value.array();
            skipWhitespace();
            if (s.charAt(pos) == ']') { pos++; return arr; }
            while (true) {
                arr.add(parseValue());
                skipWhitespace();
                if (s.charAt(pos++) == ']') break;
            }
            return arr;
        }

        private String parseString() {
            pos++; // opening quote
            StringBuilder sb = new StringBuilder();
            while (true) {
                char c = s.charAt(pos++);
                if (c == '"') break;
                if (c == '\\') {
                    char esc = s.charAt(pos++);
                    switch (esc) {
                        case '"': sb.append('"'); break;
                        case '\\': sb.append('\\'); break;
                        case '/': sb.append('/'); break;
                        case 'n': sb.append('\n'); break;
                        case 'r': sb.append('\r'); break;
                        case 't': sb.append('\t'); break;
                        case 'b': sb.append('\b'); break;
                        case 'f': sb.append('\f'); break;
                        case 'u':
                            sb.append((char) Integer.parseInt(s.substring(pos, pos + 4), 16));
                            pos += 4;
                            break;
                        default: sb.append(esc);
                    }
                } else {
                    sb.append(c);
                }
            }
            return sb.toString();
        }

        private Value parseNumber() {
            int start = pos;
            if (s.charAt(pos) == '-') pos++;
            while (pos < s.length() && Character.isDigit(s.charAt(pos))) pos++;
            boolean isDouble = false;
            if (pos < s.length() && s.charAt(pos) == '.') {
                isDouble = true;
                pos++;
                while (pos < s.length() && Character.isDigit(s.charAt(pos))) pos++;
            }
            if (pos < s.length() && (s.charAt(pos) == 'e' || s.charAt(pos) == 'E')) {
                isDouble = true;
                pos++;
                if (s.charAt(pos) == '+' || s.charAt(pos) == '-') pos++;
                while (pos < s.length() && Character.isDigit(s.charAt(pos))) pos++;
            }
            String numStr = s.substring(start, pos);
            return isDouble ? Value.of(Double.parseDouble(numStr)) : Value.of(Long.parseLong(numStr));
        }
    }
}
