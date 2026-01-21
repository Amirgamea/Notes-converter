function Str(el)
  -- Define ranges for symbols that need special font
  local text = el.text
  local new_inlines = {}
  local start = 1
  local current_is_symbol = false
  
  -- Iterate through characters (unicode aware)
  for i, c in utf8.codes(text) do
    local is_symbol = false
    
    -- Check ranges
    if (c >= 0x0370 and c <= 0x03FF) or -- Greek
       (c >= 0x2200 and c <= 0x22FF) or -- Math Operators
       (c >= 0x2190 and c <= 0x21FF) or -- Arrows
       (c >= 0x2070 and c <= 0x209F) or -- Super/Subscripts
       (c >= 0x25A0 and c <= 0x25FF) or -- Geometric Shapes
       (c >= 0x2600 and c <= 0x27BF) then -- Misc Symbols
       is_symbol = true
    end

    -- Common individual symbols
    local char = utf8.char(c)
    if char == '°' or char == '±' or char == '²' or char == '³' or char == '×' or char == '÷' then
        is_symbol = true
    end

    if is_symbol then
        -- Wrap in span with custom style
        table.insert(new_inlines, pandoc.Span(pandoc.Str(char), {['custom-style'] = 'Symbols'}))
    else
        table.insert(new_inlines, pandoc.Str(char))
    end
  end
  
  return new_inlines
end