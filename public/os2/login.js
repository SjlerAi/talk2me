const form=document.getElementById('loginForm');
const button=document.getElementById('loginButton');
const errorBox=document.getElementById('loginError');
const messages={INVALID_LOGIN:'The username/email or password is incorrect.',ENTER_USERNAME_AND_PASSWORD:'Enter your username or email and password.',DATABASE_NOT_CONFIGURED:'The OS2 database connection is not configured.',LOGIN_FAILED:'Login could not be completed. Please try again.'};
form.addEventListener('submit',async event=>{
  event.preventDefault();
  errorBox.textContent='';
  button.disabled=true;
  button.textContent='Signing in…';
  try{
    const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({identity:document.getElementById('identity').value.trim(),password:document.getElementById('password').value})});
    const data=await response.json();
    if(!response.ok||!data.ok) throw new Error(data.error||'LOGIN_FAILED');
    window.location.replace('/');
  }catch(error){
    errorBox.textContent=messages[error.message]||'Login could not be completed. Please try again.';
    button.disabled=false;
    button.textContent='Sign in';
  }
});
