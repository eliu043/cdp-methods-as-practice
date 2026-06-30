// script.js
// example of a function
function showMessage() {
  const message = document.getElementById("message");
  message.textContent = "You clicked the button!";
}

// This JavaScript code runs when the HTML page finishes loading
// We wait for the page to load so we can be sure all HTML elements exist

// This function runs when the page is ready
document.addEventListener('DOMContentLoaded', function() {
    // DOMContentLoaded means all the HTML has been loaded and parsed
    // This is important because we need to find HTML elements with JavaScript
    
    console.log('JavaScript is now running!'); // This message appears in the browser's console (F12 to see it)
    
    // Find our button in the HTML using its ID
    // getElementById looks for an HTML element with the specified ID
    const button = document.getElementById('demoButton');
    
    // Find our message display area in the HTML using its ID
    // This is where we'll show messages when the button is clicked
    const messageArea = document.getElementById('messageDisplay');
    
    // Add a "click event listener" to our button
    // This tells JavaScript: "When someone clicks this button, do something"
    button.addEventListener('click', function() {
        // This function runs every time the button is clicked
        
        console.log('Button was clicked!'); // Log to console for debugging
        
        // Create a message to display
        const currentTime = new Date().toLocaleTimeString(); // Get current time
        const message = 'Hello! You clicked the button at ' + currentTime;
        
        // Display the message in our message area
        // textContent sets the text inside the HTML element
        messageArea.textContent = message;
        
        // Add some visual feedback by changing the button text temporarily
        button.textContent = 'Thanks for clicking!';
        
        // After 2 seconds, change the button text back to original
        // setTimeout runs a function after a specified delay (in milliseconds)
        setTimeout(function() {
            button.textContent = 'Click Me!';
        }, 2000); // 2000 milliseconds = 2 seconds
    });
});


