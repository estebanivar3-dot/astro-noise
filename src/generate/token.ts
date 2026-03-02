/**
 * Shared HF API token management — localStorage read/write/clear/mask.
 * Used by both Generate and Re-Dream tools.
 */

const TOKEN_KEY = 'cvlt-hf-token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function storeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function maskToken(token: string): string {
  if (token.length <= 6) return '****';
  return token.slice(0, 3) + '****' + token.slice(-2);
}

/**
 * Build the token input/display section into a container element.
 * Calls `onTokenChange` whenever the token is saved or cleared.
 */
export function buildTokenSection(
  container: HTMLElement,
  onTokenChange: () => void,
): void {
  const section = document.createElement('div');
  section.className = 'control-group';

  function render(): void {
    while (section.firstChild) section.removeChild(section.firstChild);

    const token = getStoredToken();

    if (token) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';
      row.style.gap = '8px';

      const label = document.createElement('span');
      label.className = 'control-hint';
      label.textContent = `API Key: ${maskToken(token)}`;
      label.style.margin = '0';

      const clearBtn = document.createElement('button');
      clearBtn.className = 'btn btn-secondary';
      clearBtn.textContent = 'Clear';
      clearBtn.style.padding = '2px 8px';
      clearBtn.style.fontSize = '0.75rem';
      clearBtn.addEventListener('click', () => {
        clearStoredToken();
        render();
        onTokenChange();
      });

      row.appendChild(label);
      row.appendChild(clearBtn);
      section.appendChild(row);
    } else {
      const hint = document.createElement('div');
      hint.className = 'control-hint';

      const hintText = document.createTextNode('HF API token \u2014 ');
      hint.appendChild(hintText);

      const link = document.createElement('a');
      link.href = 'https://huggingface.co/settings/tokens';
      link.target = '_blank';
      link.rel = 'noopener';
      link.style.color = 'inherit';
      link.style.textDecoration = 'underline';
      link.textContent = 'get one free';
      hint.appendChild(link);

      section.appendChild(hint);

      const permHint = document.createElement('div');
      permHint.className = 'control-hint';
      permHint.style.marginTop = '2px';
      permHint.style.fontSize = '0.7rem';
      permHint.textContent = 'Needs: "Make calls to Inference Providers"';
      section.appendChild(permHint);

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '6px';

      const input = document.createElement('input');
      input.type = 'password';
      input.placeholder = 'hf_xxxxx';
      input.style.flex = '1';
      input.style.fontFamily = 'inherit';
      input.style.fontSize = '0.8rem';
      input.style.padding = '4px 8px';
      input.style.background = 'var(--bg-element, #1a1a1a)';
      input.style.color = 'inherit';
      input.style.border = '1px solid var(--border, #333)';
      input.style.borderRadius = '4px';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn btn-secondary';
      saveBtn.textContent = 'Save';
      saveBtn.style.padding = '4px 12px';
      saveBtn.style.fontSize = '0.8rem';
      saveBtn.addEventListener('click', () => {
        const val = input.value.trim();
        if (val) {
          storeToken(val);
          render();
          onTokenChange();
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveBtn.click();
        }
      });

      row.appendChild(input);
      row.appendChild(saveBtn);
      section.appendChild(row);
    }
  }

  render();
  container.appendChild(section);
}
