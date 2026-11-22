use std::path::Path;

pub fn natural_order(a: &str, b: &str) -> std::cmp::Ordering {
    fn has_word_prefix(s: &str, prefix: &str) -> bool {
        if let Some(rest) = s.strip_prefix(prefix) {
            rest.is_empty() || !rest.chars().next().unwrap().is_alphanumeric()
        } else {
            false
        }
    }

    fn category(s: &str) -> i32 {
        let trimmed = s.trim_start();
        let lower = trimmed.to_lowercase();
        if has_word_prefix(&lower, "prologue") || has_word_prefix(&lower, "opening") {
            -1
        } else if has_word_prefix(&lower, "extra")
            || has_word_prefix(&lower, "bonus")
            || has_word_prefix(&lower, "special")
            || has_word_prefix(&lower, "epilogue")
        {
            1
        } else {
            0
        }
    }

    let cat_a = category(a);
    let cat_b = category(b);
    if cat_a != cat_b {
        return cat_a.cmp(&cat_b);
    }

    #[derive(Debug, PartialEq)]
    enum Token<'a> {
        Num(u128, usize),
        BigNum(&'a str),
        Str(&'a str),
    }

    fn extract_tokens(s: &str) -> Vec<Token<'_>> {
        let mut tokens = Vec::new();
        let mut start = 0;
        let mut in_num = false;
        let bytes = s.as_bytes();
        let len = bytes.len();

        let mut i = 0;
        while i < len {
            let c = bytes[i];
            let is_digit = c.is_ascii_digit();
            if is_digit != in_num {
                if i > start {
                    let slice = &s[start..i];
                    if in_num {
                        if let Ok(n) = slice.parse::<u128>() {
                            tokens.push(Token::Num(n, slice.len()));
                        } else {
                            tokens.push(Token::BigNum(slice));
                        }
                    } else {
                        tokens.push(Token::Str(slice));
                    }
                }
                start = i;
                in_num = is_digit;
            }
            i += 1;
        }

        if start < len {
            let slice = &s[start..len];
            if in_num {
                if let Ok(n) = slice.parse::<u128>() {
                    tokens.push(Token::Num(n, slice.len()));
                } else {
                    tokens.push(Token::BigNum(slice));
                }
            } else {
                tokens.push(Token::Str(slice));
            }
        }

        tokens
    }

    let lower_a = a.to_lowercase();
    let lower_b = b.to_lowercase();

    let tokens_a = extract_tokens(&lower_a);
    let tokens_b = extract_tokens(&lower_b);

    for (x, y) in tokens_a.iter().zip(tokens_b.iter()) {
        match (x, y) {
            (Token::Num(nx, lx), Token::Num(ny, ly)) => {
                let ord = nx.cmp(ny);
                if ord != std::cmp::Ordering::Equal {
                    return ord;
                }
                if lx != ly {
                    return lx.cmp(ly);
                }
            }
            (Token::BigNum(bx), Token::BigNum(by)) => {
                let tx = bx.trim_start_matches('0');
                let ty = by.trim_start_matches('0');
                let ord = tx.len().cmp(&ty.len()).then_with(|| tx.cmp(ty));
                if ord != std::cmp::Ordering::Equal {
                    return ord;
                }
                if bx.len() != by.len() {
                    return bx.len().cmp(&by.len());
                }
            }
            (Token::Num(nx, _), Token::BigNum(by)) => {
                let ty = by.trim_start_matches('0');
                if ty.len() > 38 {
                    return std::cmp::Ordering::Less;
                }
                if let Ok(ny) = ty.parse::<u128>() {
                    let ord = nx.cmp(&ny);
                    if ord != std::cmp::Ordering::Equal {
                        return ord;
                    }
                }
                return std::cmp::Ordering::Less;
            }
            (Token::BigNum(bx), Token::Num(ny, _)) => {
                let tx = bx.trim_start_matches('0');
                if tx.len() > 38 {
                    return std::cmp::Ordering::Greater;
                }
                if let Ok(nx) = tx.parse::<u128>() {
                    let ord = nx.cmp(ny);
                    if ord != std::cmp::Ordering::Equal {
                        return ord;
                    }
                }
                return std::cmp::Ordering::Greater;
            }
            (Token::Str(sx), Token::Str(sy)) => {
                let ord = sx.chars().cmp(sy.chars());
                if ord != std::cmp::Ordering::Equal {
                    return ord;
                }
            }
            (Token::Num(_, _) | Token::BigNum(_), Token::Str(_)) => {
                return std::cmp::Ordering::Less;
            }
            (Token::Str(_), Token::Num(_, _) | Token::BigNum(_)) => {
                return std::cmp::Ordering::Greater;
            }
        }
    }

    tokens_a.len().cmp(&tokens_b.len()).then_with(|| a.cmp(b))
}

#[tauri::command(async)]
pub fn natural_sort_paths(mut paths: Vec<String>) -> Vec<String> {
    paths.sort_by(|a, b| natural_order(a, b));
    paths
}

#[tauri::command(async)]
pub fn is_same_path(path_a: String, path_b: String) -> bool {
    let pa = Path::new(path_a.trim());
    let pb = Path::new(path_b.trim());
    if let (Ok(ca), Ok(cb)) = (dunce::canonicalize(pa), dunce::canonicalize(pb)) {
        return ca == cb;
    }
    let norm_a = path_a
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase();
    let norm_b = path_b
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase();
    norm_a == norm_b
}
